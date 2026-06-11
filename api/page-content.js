export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, pageId } = req.body;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const url = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.view,title`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    if (!response.ok) return res.status(response.status).json({ error: '페이지 로드 실패' });

    const data = await response.json();
    // body.view는 렌더링된 HTML (이미지 제외한 텍스트 추출용)
    const rawHtml = data.body?.view?.value || '';
    const text = rawHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\t/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // HTML도 함께 반환 (패널 렌더링용)
    const html = rawHtml;

    res.json({ success: true, title: data.title, content: text, html });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
