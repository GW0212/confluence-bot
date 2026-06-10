# ⚔ ArcheAge WAR 기획서 AI 어시스턴트

Confluence 기획서를 자동으로 불러와 AI(Google Gemini)가 질문에 답해주는 웹앱입니다.  
**완전 무료!** (Gemini 1.5 Flash - 무료 티어)

---

## 🚀 배포 방법 (GitHub → Vercel)

### 1단계 - GitHub에 업로드
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_ID/confluence-bot.git
git push -u origin main
```

### 2단계 - Vercel 배포
1. https://vercel.com 접속 → GitHub 계정으로 로그인
2. **New Project** → GitHub 레포 선택
3. **Environment Variables** 탭에서 추가:
   - Key: `GEMINI_API_KEY`
   - Value: Google AI Studio에서 발급한 키
4. **Deploy** 클릭!

---

## 🔑 필요한 키 2가지

| 키 | 발급처 | 비용 |
|----|--------|------|
| Atlassian API Token | https://id.atlassian.com/manage-profile/security/api-tokens | 무료 |
| Gemini API Key | https://aistudio.google.com/app/apikey | **완전 무료** |

---

## ⚙️ 환경변수 (Vercel Dashboard에서 설정)

| 변수명 | 설명 |
|--------|------|
| `GEMINI_API_KEY` | Google AI Studio에서 발급한 키 |
