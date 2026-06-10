export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, spaceKey } = req.body;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    let allPages = [];
    let start = 0;
    const limit = 50;

    while (true) {
      const url = `${baseUrl}/wiki/rest/api/content?spaceKey=${spaceKey}&limit=${limit}&start=${start}&type=page`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });

      if (response.status === 401) return res.status(401).json({ error: '인증 실패. 이메일/토큰을 확인해주세요.' });
      if (response.status === 403) return res.status(403).json({ error: '접근 권한이 없어요.' });
      if (response.status === 404) return res.status(404).json({ error: 'Space를 찾지 못했어요.' });

      const data = await response.json();
      const results = data.results || [];
      allPages = allPages.concat(results);

      if (results.length < limit) break;
      start += limit;
      if (allPages.length >= 200) break;
    }

    res.json({ success: true, pages: allPages.map(p => ({ id: p.id, title: p.title })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
