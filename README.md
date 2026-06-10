# ⚔ ArcheAge WAR 기획서 AI 어시스턴트

Confluence 기획서를 자동으로 불러와 AI가 질문에 답해주는 웹앱입니다.  
GitHub → Vercel 배포로 무료로 사용할 수 있어요.

---

## 🚀 배포 방법 (GitHub → Vercel)

### 1단계 - GitHub에 업로드
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_ID/confluence-ai-bot.git
git push -u origin main
```

### 2단계 - Vercel 배포
1. https://vercel.com 접속 → GitHub 계정으로 로그인
2. **New Project** → GitHub 레포 선택
3. **Environment Variables** 탭에서 추가:
   - Key: `ANTHROPIC_API_KEY`
   - Value: Anthropic API 키 (https://console.anthropic.com)
4. **Deploy** 클릭!

### 3단계 - 사용
배포 완료 후 Vercel이 제공하는 URL로 접속  
→ 이메일 + API 토큰 입력 → 기획서 불러오기 → 질문!

---

## 📁 파일 구조
```
confluence-ai-bot/
├── api/
│   ├── pages.js          # Confluence 페이지 목록 API
│   ├── page-content.js   # 페이지 내용 가져오기 API
│   └── ask.js            # AI 질문 답변 API
├── public/
│   └── index.html        # 프론트엔드
├── vercel.json           # Vercel 설정
└── package.json
```

---

## 🔑 필요한 키 2가지

| 키 | 발급처 | 용도 |
|----|--------|------|
| Atlassian API Token | https://id.atlassian.com/manage-profile/security/api-tokens | Confluence 읽기 |
| Anthropic API Key | https://console.anthropic.com | AI 답변 생성 |

> Anthropic API Key는 Vercel 환경변수로만 설정 (코드에 절대 포함 금지!)

---

## ⚙️ 환경변수 (Vercel Dashboard에서 설정)

| 변수명 | 설명 |
|--------|------|
| `ANTHROPIC_API_KEY` | Anthropic 콘솔에서 발급한 API 키 |
