export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, spaceKey, limit: reqLimit } = req.body;
  if (!email || !token || !baseUrl || !spaceKey) {
    return res.status(400).json({ error: '필수 파라미터가 누락되었어요.' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };
  const limit = Math.min(reqLimit || 10, 20); // 최대 20개

  try {
    // Confluence CQL: 해당 Space 내 페이지를 최근 수정일 순으로 조회
    const cql = `space="${spaceKey}" AND type=page ORDER BY lastModified DESC`;
    const url = `${baseUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=version,body.view,space`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.message || 'Confluence API 오류' });
    }

    const data = await response.json();
    const results = data.results || [];

    const pages = results.map(p => {
      const rawHtml = p.body?.view?.value || '';

      // HTML → 텍스트 변환 (page-content.js와 동일한 방식)
      let text = rawHtml
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/gi, '')
        .replace(/<ac:plain-text-body>[\s\S]*?<\/ac:plain-text-body>/gi, '')
        .replace(/<div[^>]*page-metadata[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/\s(style|data-[\w-]+)="[^"]*"/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '').replace(/&gt;/g, '')
        .replace(/\t/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        // 변경이력 문장 제거
        .replace(/\S+\.(xlsx|docx|pptx|pdf|hwp|zip|csv|png|jpg)\s+파일[이이]?\s+\S+에\s+의해\s+변경되었습니다\.?/gi, '');

      const lastModified = p.version?.when || null;
      const pageUrl = `${baseUrl}/wiki/spaces/${p.space?.key || spaceKey}/pages/${p.id}`;

      return {
        id: p.id,
        title: p.title,
        lastModified,          // ISO 형식 실제 수정일 (예: "2026-06-20T09:15:00.000Z")
        content: text.substring(0, 3000),
        pageUrl
      };
    });

    res.json({ success: true, pages, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
