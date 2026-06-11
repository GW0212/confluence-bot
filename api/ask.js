export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  // ── 질문 키워드로 관련 페이지만 추출 (토큰 절약) ──
  const pages = context.split(/\n=== \[/).slice(1).map(chunk => {
    const titleEnd = chunk.indexOf('] ===');
    const title = chunk.substring(0, titleEnd);
    const content = chunk.substring(titleEnd + 5).trim();
    return { title, content };
  });

  // 질문 키워드 기반 관련 페이지 필터링
  const qLower = question.toLowerCase();
  const qKeywords = qLower.split(/[\s,./()]+/).filter(w => w.length >= 2);

  let relevant = pages.filter(p => {
    const text = (p.title + ' ' + p.content).toLowerCase();
    return qKeywords.some(kw => text.includes(kw));
  });

  // 관련 페이지가 없으면 전체 중 앞부분 사용
  if (relevant.length === 0) relevant = pages.slice(0, 30);

  // 최대 60개, 페이지당 1500자로 제한 (토큰 절약)
  const trimmed = relevant.slice(0, 60);
  const filteredCtx = trimmed.map(p =>
    `=== [${p.title}] ===\n${p.content.substring(0, 1500)}`
  ).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래에 Confluence에서 가져온 실제 기획서 원문이 있어. 이 내용을 100% 기반으로 질문에 답해.

[중요 규칙]
1. 기획서 원문에 있는 내용은 반드시 상세히 답해.
2. 관련 키워드가 있으면 모두 찾아서 종합적으로 답해.
3. 답변 시 어떤 페이지([페이지명])의 내용인지 출처를 표시해.
4. 기획서에 정말로 없는 내용만 "기획서에서 찾을 수 없습니다"라고 해.
5. 한국어로 답해.
6. ## 제목과 - 항목으로 구조화해서 답해.
7. 수치나 데이터는 원문 그대로 정확히 인용해.

[기획서 원문 - 관련 페이지 ${trimmed.length}개]
${filteredCtx}

[질문]
${question}`;

  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
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
            generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
          })
        }
      );
      const data = await response.json();
      if (data.error) {
        // rate limit이면 다음 모델 시도
        if (data.error.code === 429) { lastError = data.error.message; continue; }
        throw new Error(data.error.message);
      }
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!answer) { lastError = '응답을 받지 못했어요.'; continue; }
      return res.json({ success: true, answer, model, pagesUsed: trimmed.length });
    } catch (e) {
      lastError = e.message; continue;
    }
  }
  res.status(500).json({ error: `AI 응답 실패: ${lastError}` });
}
