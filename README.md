# 독서 기록 사이트 (Reading Record Frontend)

병렬 독서자를 위한 독서 기록 서비스의 웹 프론트엔드 프로젝트입니다.

## 프로젝트 개요

이 프로젝트는 분산2_프로젝트(백엔드)와 연동하여 독서 기록을 관리하는 웹 애플리케이션입니다.

## 기술 스택

### 프론트엔드
- **HTML5**: 웹 페이지 구조 및 마크업
- **CSS3**: 스타일링 및 레이아웃
- **JavaScript (ES6+)**: 클라이언트 사이드 로직 및 API 통신 (Fetch API)

### 백엔드 (분산2_프로젝트)
- **Spring Boot**: Java 기반 웹 애플리케이션 프레임워크
- **Spring MVC**: 프론트엔드와 백엔드 간 통신 및 RESTful API 제공
- **JPA**: Java Persistence API (데이터베이스 ORM)
- **MySQL**: 관계형 데이터베이스 관리 시스템

## 시작하기

### 사전 요구사항

- Node.js 14.x 이상 (개발 서버 사용 시)
- 또는 간단한 HTTP 서버 (예: Python의 http.server, PHP의 built-in server 등)
- 백엔드 서버 (Spring Boot)가 `http://localhost:8080`에서 실행 중이어야 합니다

### 설치 (선택사항)

개발 서버를 사용하려면:

```bash
# 의존성 설치
npm install
```

### 개발 서버 실행

#### 방법 1: npm 스크립트 사용 (권장)

```bash
npm run dev
# 또는
npm start
```

개발 서버는 `http://localhost:5500`에서 실행됩니다.

#### 방법 2: 직접 파일 열기

브라우저에서 `index.html` 파일을 직접 열어도 됩니다.

#### 방법 3: Python HTTP 서버 사용

```bash
# Python 3
python -m http.server 5500

# Python 2
python -m SimpleHTTPServer 5500
```

### API 서버 주소 설정

`js/api/config.js` 파일에서 백엔드 서버 주소를 설정할 수 있습니다:

```javascript
const API_BASE_URL = window.API_BASE_URL || 'http://localhost:8080';
```

또는 HTML 파일에서 전역 변수로 설정:

```html
<script>
    window.API_BASE_URL = 'http://localhost:8080';
</script>
```

## 프로젝트 구조

```
├── css/
│   └── style.css          # 전역 스타일
├── js/
│   ├── api/
│   │   ├── config.js      # API 설정
│   │   └── client.js      # API 클라이언트 (Fetch API)
│   └── main.js            # 메인 JavaScript 파일
├── docs/
│   └── BACKEND_INTEGRATION.md  # 백엔드 연동 가이드
├── index.html             # 메인 HTML 파일
├── ARCHITECTURE.md        # 프로젝트 아키텍처 문서
├── package.json           # 프로젝트 의존성 (선택사항)
└── README.md              # 프로젝트 문서
```

## 백엔드 연동

백엔드 서버는 기본적으로 `http://localhost:8080`에서 실행됩니다.

프론트엔드에서 직접 백엔드 API를 호출하므로, 백엔드에서 CORS 설정이 필요합니다.

자세한 내용은 [백엔드 연동 가이드](docs/BACKEND_INTEGRATION.md)를 참고하세요.

## GitHub 저장소 연동

### 1. GitHub에서 새 저장소 생성

1. GitHub에 로그인
2. 우측 상단의 "+" 버튼 클릭 → "New repository" 선택
3. 저장소 이름 입력 (예: `reading-record-frontend`)
4. Public 또는 Private 선택
5. **"Initialize this repository with a README" 체크하지 않기** (이미 README가 있으므로)
6. "Create repository" 클릭

### 2. 로컬 저장소와 연결

GitHub에서 생성한 저장소의 URL을 복사한 후, 다음 명령어를 실행하세요:

```bash
# 원격 저장소 추가 (YOUR_USERNAME과 YOUR_REPO_NAME을 실제 값으로 변경)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 파일 추가
git add .

# 첫 커밋
git commit -m "Initial commit: 독서 기록 사이트 프론트엔드 프로젝트"

# 메인 브랜치로 푸시
git branch -M main
git push -u origin main
```

## 백엔드 연동 단계

### 1단계: 백엔드 서버 확인

- 백엔드 서버가 실행 중인지 확인
- 백엔드 API 엔드포인트 문서 확인
- CORS 설정이 프론트엔드 도메인을 허용하는지 확인

### 2단계: API 서버 주소 설정

`js/api/config.js` 파일에서 백엔드 서버 주소를 확인하거나 수정합니다.

### 3단계: CORS 설정 확인

백엔드에서 CORS를 허용하도록 설정되어 있어야 합니다:

```java
// Spring Boot 예시
@CrossOrigin(origins = "http://localhost:5500")  // 프론트엔드 서버 주소
```

### 4단계: API 엔드포인트 구현

백엔드 API 문서를 참고하여 필요한 API 호출 함수를 구현합니다.

예시:
```javascript
// js/api/readingRecord.js
async function getReadingRecords() {
    try {
        const records = await window.apiClient.get('/api/reading-records');
        return records;
    } catch (error) {
        console.error('독서 기록 조회 실패:', error);
        throw error;
    }
}

async function createReadingRecord(data) {
    try {
        const result = await window.apiClient.post('/api/reading-records', data);
        return result;
    } catch (error) {
        console.error('독서 기록 생성 실패:', error);
        throw error;
    }
}
```

### 5단계: 인증 처리

백엔드에서 JWT 토큰을 사용하는 경우:
- 로그인 시 토큰을 받아 `localStorage`에 저장
- `js/api/client.js`가 자동으로 토큰을 헤더에 추가

### 6단계: 테스트

- 개발 서버 실행: `npm run dev` 또는 브라우저에서 `index.html` 직접 열기
- 브라우저 개발자 도구(F12)에서 API 호출 테스트
- 네트워크 탭에서 요청/응답 확인

자세한 내용은 [백엔드 연동 가이드](docs/BACKEND_INTEGRATION.md)를 참고하세요.

## 라이선스

이 프로젝트는 교육 목적으로 개발되었습니다.

