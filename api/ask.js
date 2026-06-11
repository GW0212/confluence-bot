export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  // 질문 키워드로 관련 페이지 필터링
  const pages = context.split(/(?=\n?=== \[)/).filter(c => c.includes('=== [')).map(chunk => {
    const m = chunk.match(/=== \[(.+?)\] ===/);
    const title = m ? m[1] : '';
    const content = chunk.replace(/=== \[.+?\] ===\n?/, '').trim();
    return { title, content };
  });

  const qLower = question.toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]]+/).filter(w => w.length >= 2);

  // 점수 기반 정렬: 제목 매칭 3점, 본문 매칭 1점
  const scored = pages.map(p => {
    const titleLower = p.title.toLowerCase();
    const contentLower = p.content.toLowerCase();
    let score = 0;
    qKeywords.forEach(kw => {
      if (titleLower.includes(kw)) score += 3;
      if (contentLower.includes(kw)) score += 1;
    });
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  let relevant = scored.length > 0 ? scored : pages.slice(0, 20);

  // 상위 40개, 페이지당 2000자
  const trimmed = relevant.slice(0, 40);
  const filteredCtx = trimmed.map(p =>
    `=== [${p.title}] ===\n${p.content.substring(0, 2000)}`
  ).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 바탕으로 질문에 정확하게 답해.

[답변 규칙]
1. 기획서에 있는 내용만 답해. 추측하지 마.
2. 핵심 정보만 간결하게 정리해. 불필요한 말은 빼.
3. 반드시 아래 형식을 지켜서 출처 페이지를 표시해:
   - 제목이나 서브제목 뒤에 반드시 [[페이지명]] 형식으로 출처 표시
   - 예: ## 경직 시스템 [[경직]]
   - 예: ### 경직 시간 계산 [[경직]]
4. 수치/데이터는 원문 그대로 인용해.
5. 기획서에 없는 내용이면 "기획서에서 찾을 수 없습니다"라고 해.
6. 한국어로 답해.
7. ## 제목, - 항목으로 구조화해서 답해.

[기획서 원문]
${filteredCtx}

[질문]
${question}`;

  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ];

  let lastError = '';
  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 2000 }
          })
        }
      );
      const data = await response.json();
      if (data.error) {
        if (data.error.code === 429) { lastError = data.error.message; continue; }
        throw new Error(data.error.message);
      }
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!answer) { lastError = '응답을 받지 못했어요.'; continue; }
      return res.json({ success: true, answer, model });
    } catch (e) {
      lastError = e.message; continue;
    }
  }
  res.status(500).json({ error: `AI 응답 실패: ${lastError}` });
}
