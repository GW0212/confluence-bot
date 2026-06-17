export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, spaceKey, start: reqStart } = req.body;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };
  const limit = 100;

  try {
    let allPages = [];
    let start = reqStart || 0;
    const startTime = Date.now();
    const MAX_TIME = 25000; // 25초 안에서만 작업 (Vercel 30초 한도 대응)

    while (true) {
      // 시간 초과 임박하면 중단하고 다음 페이지네이션 정보 반환
      if (Date.now() - startTime > MAX_TIME) {
        return res.json({
          success: true,
          pages: allPages,
          partial: true,
          nextStart: start,
        });
      }

      const url = `${baseUrl}/wiki/rest/api/content?spaceKey=${spaceKey}&limit=${limit}&start=${start}&type=page&expand=ancestors`;
      const response = await fetch(url, { headers });

      if (response.status === 401) return res.status(401).json({ error: '인증 실패. 이메일/토큰을 확인해주세요.' });
      if (response.status === 403) return res.status(403).json({ error: '접근 권한이 없어요.' });
      if (response.status === 404) return res.status(404).json({ error: 'Space를 찾지 못했어요.' });
      if (!response.ok) return res.status(response.status).json({ error: `Confluence API 오류 (${response.status})` });

      const data = await response.json();
      const results = data.results || [];
      allPages = allPages.concat(results.map(p => ({
        id: p.id,
        title: p.title,
        ancestors: p.ancestors || []
      })));

      if (results.length < limit) break;
      start += limit;
    }

    res.json({ success: true, pages: allPages, partial: false });
  } catch (e) {
    res.status(500).json({ error: e.message || '페이지 목록을 불러오는 중 오류가 발생했어요.' });
  }
}
