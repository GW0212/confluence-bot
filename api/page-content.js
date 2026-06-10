export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, pageId } = req.body;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const url = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,title`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    if (!response.ok) return res.status(response.status).json({ error: '페이지 로드 실패' });

    const data = await response.json();
    const rawHtml = data.body?.storage?.value || '';
    const text = rawHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    res.json({ success: true, title: data.title, content: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
