export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래에 Confluence에서 가져온 실제 기획서 원문이 주어져. 이 내용을 100% 기반으로 질문에 답해.

[중요 규칙]
1. 기획서 원문에 있는 내용은 반드시 상세히 답해. 절대 "찾을 수 없습니다"라고 하지 마.
2. 기획서 원문에서 관련 키워드가 조금이라도 있으면 그 내용을 모두 찾아서 답해.
3. 답변할 때 어떤 페이지([페이지명])의 내용인지 출처를 함께 표시해.
4. 기획서에 정말로 없는 내용만 "기획서에서 찾을 수 없습니다"라고 해.
5. 한국어로 답해.
6. 내용이 많으면 ## 제목과 - 항목으로 구조화해서 답해.
7. 수치나 데이터는 원문 그대로 정확히 인용해.

[기획서 원문]
${context}

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
            generationConfig: { temperature: 0.1, maxOutputTokens: 3000 }
          })
        }
      );
      const data = await response.json();
      if (data.error) { lastError = data.error.message; continue; }
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!answer) { lastError = '응답을 받지 못했어요.'; continue; }
      return res.json({ success: true, answer, model });
    } catch (e) {
      lastError = e.message; continue;
    }
  }
  res.status(500).json({ error: `AI 응답 실패: ${lastError}` });
}
