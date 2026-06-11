export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, spaceKey } = req.body;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  try {
    // 페이지 제한 없이 전체 로딩
    let allPages = [];
    let start = 0;
    const limit = 50;

    while (true) {
      const url = `${baseUrl}/wiki/rest/api/content?spaceKey=${spaceKey}&limit=${limit}&start=${start}&type=page&expand=ancestors,version`;
      const response = await fetch(url, { headers });

      if (response.status === 401) return res.status(401).json({ error: '인증 실패. 이메일/토큰을 확인해주세요.' });
      if (response.status === 403) return res.status(403).json({ error: '접근 권한이 없어요.' });
      if (response.status === 404) return res.status(404).json({ error: 'Space를 찾지 못했어요.' });

      const data = await response.json();
      const results = data.results || [];
      allPages = allPages.concat(results);

      // 다음 페이지가 없으면 종료
      if (results.length < limit) break;
      start += limit;
    }

    // 트리 구조 구성
    const pageMap = {};
    allPages.forEach(p => {
      pageMap[p.id] = {
        id: p.id,
        title: p.title,
        parentId: p.ancestors?.length > 0 ? p.ancestors[p.ancestors.length - 1].id : null,
        children: [],
        depth: p.ancestors?.length || 0,
      };
    });

    Object.values(pageMap).forEach(p => {
      if (p.parentId && pageMap[p.parentId]) {
        pageMap[p.parentId].children.push(p.id);
      }
    });

    // DFS 순서로 정렬
    const roots = Object.values(pageMap).filter(p => !p.parentId || !pageMap[p.parentId]);
    const ordered = [];
    function dfs(id) {
      const p = pageMap[id];
      if (!p) return;
      ordered.push({ id: p.id, title: p.title, depth: p.depth, hasChildren: p.children.length > 0 });
      p.children.forEach(childId => dfs(childId));
    }
    roots.forEach(r => dfs(r.id));

    res.json({ success: true, pages: ordered, total: ordered.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
