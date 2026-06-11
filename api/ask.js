export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  // 질문 키워드 기반 점수 정렬
  const pages = [];
  const chunks = context.split(/(?=\n?=== \[)/);
  for (const chunk of chunks) {
    const m = chunk.match(/=== \[(.+?)\] ===/);
    if (!m) continue;
    const title = m[1];
    const content = chunk.replace(/=== \[.+?\] ===\n?/, '').trim();
    pages.push({ title, content });
  }

  const qLower = question.toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]]+/).filter(w => w.length >= 2);

  const scored = pages.map(p => {
    const tl = p.title.toLowerCase();
    const cl = p.content.toLowerCase();
    let score = 0;
    qKeywords.forEach(kw => {
      if (tl.includes(kw)) score += 5;
      if (cl.includes(kw)) score += (cl.split(kw).length - 1); // 등장 횟수만큼
    });
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  const relevant = scored.length > 0 ? scored.slice(0, 50) : pages.slice(0, 20);

  // 상위 페이지는 전문, 나머지는 2500자
  const filteredCtx = relevant.map((p, i) =>
    `=== [${p.title}] ===\n${i < 10 ? p.content : p.content.substring(0, 2500)}`
  ).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 바탕으로 질문에 답해.

[핵심 규칙]
1. 기획서 원문에 있는 내용을 빠짐없이 상세하게 답해. 절대 요약하거나 생략하지 마.
2. 수치, 공식, 조건, 예외사항까지 전부 포함해서 답해.
3. 제목/서브제목 뒤에 반드시 [[페이지명]] 형식으로 출처를 표시해.
   예: ## 경직 시스템 [[경직]]
   예: ### 경직 시간 계산 [[경직]]
4. 여러 페이지에 걸친 내용이면 페이지별로 나눠서 모두 답해.
5. 기획서에 없는 내용만 "기획서에서 찾을 수 없습니다"라고 해.
6. 한국어로 답해.
7. 구조: ## 대제목 [[출처]], ### 소제목, - 항목, 수치는 **굵게** 표시.

[기획서 원문 - ${relevant.length}개 관련 페이지]
${filteredCtx}

[질문]
${question}

위 질문에 대해 기획서 내용을 최대한 상세하고 완전하게 답해. 절대 중요한 내용을 빠뜨리지 마.`;

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

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
            generationConfig: { temperature: 0.05, maxOutputTokens: 4000 }
          })
        }
      );
      const data = await response.json();
      if (data.error) { if (data.error.code === 429) { lastError = data.error.message; continue; } throw new Error(data.error.message); }
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!answer) { lastError = '응답을 받지 못했어요.'; continue; }
      return res.json({ success: true, answer, model });
    } catch (e) { lastError = e.message; continue; }
  }
  res.status(500).json({ error: `AI 응답 실패: ${lastError}` });
}
