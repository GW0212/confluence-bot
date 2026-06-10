export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았어요.' });

  const systemPrompt = `당신은 ArcheAge WAR 게임의 기획서 전문 AI 어시스턴트입니다.
아래는 Confluence에서 불러온 실제 기획서 내용입니다. 이 내용을 철저히 분석하고, 사용자의 질문에 기획서 내용을 바탕으로 상세하고 정확하게 답변하세요.

답변 규칙:
- 기획서에 있는 내용을 우선으로 답변하세요
- 기획서에 없는 내용이면 "기획서에서 해당 내용을 찾지 못했습니다"라고 명확히 알려주세요
- 한국어로 답변하세요
- 필요하면 항목별(## 제목, - 항목)로 정리해서 답변하세요
- 수치, 데이터가 있으면 정확히 인용하세요
- 답변 마지막에 참고한 페이지명을 간략히 언급해주세요

=== 기획서 내용 ===
${context.substring(0, 90000)}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    res.json({ success: true, answer: data.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
