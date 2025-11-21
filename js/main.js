// 메인 JavaScript 파일
// DOM이 로드된 후 실행

document.addEventListener('DOMContentLoaded', function() {
    console.log('독서 기록 사이트가 로드되었습니다.');
    
    // 초기화 함수들
    initializeApp();
});

/**
 * 애플리케이션 초기화
 */
function initializeApp() {
    // API 클라이언트가 로드되었는지 확인
    if (typeof window.apiClient === 'undefined') {
        console.error('API 클라이언트가 로드되지 않았습니다.');
        return;
    }
    
    console.log('API 클라이언트가 준비되었습니다.');
    
    // 예시: 독서 기록 목록 불러오기 (필요시 주석 해제)
    // loadReadingRecords();
}

/**
 * 독서 기록 목록 불러오기 (예시)
 */
async function loadReadingRecords() {
    try {
        const records = await window.apiClient.get('/api/reading-records');
        console.log('독서 기록:', records);
        // DOM에 표시하는 로직 추가
    } catch (error) {
        console.error('독서 기록 로드 실패:', error);
    }
}

