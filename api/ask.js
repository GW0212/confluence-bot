export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  const prompt = `당신은 ArcheAge WAR 게임의 기획서 전문 AI 어시스턴트입니다.
아래는 Confluence에서 불러온 실제 기획서 내용입니다. 이 내용을 철저히 분석하고, 사용자의 질문에 기획서 내용을 바탕으로 상세하고 정확하게 답변하세요.

답변 규칙:
- 기획서에 있는 내용을 우선으로 답변하세요
- 기획서에 없는 내용이면 "기획서에서 해당 내용을 찾지 못했습니다"라고 명확히 알려주세요
- 한국어로 답변하세요
- 필요하면 항목별(## 제목, - 항목)로 정리해서 답변하세요
- 수치, 데이터가 있으면 정확히 인용하세요
- 답변 마지막에 참고한 페이지명을 간략히 언급해주세요

=== 기획서 내용 ===
${context.substring(0, 90000)}

=== 사용자 질문 ===
${question}`;

  // 시도할 모델 목록 (순서대로 fallback)
  const models = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro-latest',
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
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
          })
        }
      );

      const data = await response.json();

      if (data.error) {
        lastError = data.error.message;
        continue; // 다음 모델 시도
      }

      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!answer) {
        lastError = '응답을 받지 못했어요.';
        continue;
      }

      return res.json({ success: true, answer, model });
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  res.status(500).json({ error: `모든 모델 시도 실패: ${lastError}` });
}
