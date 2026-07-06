export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, spaceKey, since } = req.body;
  if (!email || !token || !baseUrl || !spaceKey || !since) {
    return res.status(400).json({ error: '필수 파라미터 누락' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  try {
    // since: ISO 8601 형식 (예: "2025-06-01T00:00:00.000Z")
    // CQL로 해당 시각 이후 변경된 페이지만 조회 (최대 200개)
    const sinceDate = new Date(since);
    // CQL의 lastModified는 "yyyy-MM-dd HH:mm" 형식
    const cqlDate = sinceDate.getFullYear() + '-'
      + String(sinceDate.getMonth()+1).padStart(2,'0') + '-'
      + String(sinceDate.getDate()).padStart(2,'0') + ' '
      + String(sinceDate.getHours()).padStart(2,'0') + ':'
      + String(sinceDate.getMinutes()).padStart(2,'0');

    const cql = `space="${spaceKey}" AND type=page AND lastModified > "${cqlDate}" ORDER BY lastModified ASC`;
    const url = `${baseUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=200&expand=version,ancestors`;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.message || 'Confluence API 오류' });
    }

    const data = await response.json();
    const results = data.results || [];

    // 변경된 페이지 목록만 반환 (내용은 클라이언트가 필요 시 page-content로 별도 요청)
    const pages = results.map(p => ({
      id: p.id,
      title: p.title,
      lastModified: p.version?.when || null,
      ancestors: p.ancestors || [],
      depth: p.ancestors ? p.ancestors.length : 0,
      hasChildren: false // 이후 클라이언트에서 트리 재구성 시 업데이트됨
    }));

    res.json({ success: true, pages, total: pages.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
