export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, spaceKey, title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: '검색할 제목이 없어요.' });

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  try {
    // CQL로 제목 완전일치 우선 검색 (스페이스 한정), 안 되면 부분일치로 재시도
    const cqlExact = `space="${spaceKey}" and type=page and title="${title.replace(/"/g, '\\"')}"`;
    let url = `${baseUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(cqlExact)}&limit=1&expand=body.view,space`;
    let response = await fetch(url, { headers });
    let data = await response.json();

    if (!response.ok || !data.results || data.results.length === 0) {
      // 완전일치 실패 시 부분일치(~) 검색
      const cqlFuzzy = `space="${spaceKey}" and type=page and title~"${title.replace(/"/g, '\\"')}"`;
      url = `${baseUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(cqlFuzzy)}&limit=1&expand=body.view,space`;
      response = await fetch(url, { headers });
      data = await response.json();
    }

    if (!response.ok) return res.status(response.status).json({ error: 'Confluence 검색 실패' });
    if (!data.results || data.results.length === 0) {
      return res.json({ success: false, error: '페이지를 찾지 못했어요.' });
    }

    const page = data.results[0];
    const rawHtml = page.body?.view?.value || '';

    let text = rawHtml;
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/gi, '')
      .replace(/<ac:plain-text-body>[\s\S]*?<\/ac:plain-text-body>/gi, '')
      .replace(/\s(style|data-[\w-]+)="[^"]*"/gi, '')
      .replace(/\s(style|data-[\w-]+)='[^']*'/gi, '');
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/div>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '')
      .replace(/&gt;/g, '');
    text = text
      .replace(/\t/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const pageUrl = `${baseUrl}/wiki/spaces/${page.space?.key || spaceKey || ''}/pages/${page.id}`;

    res.json({
      success: true,
      id: page.id,
      title: page.title,
      content: text,
      html: rawHtml,
      pageUrl
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
