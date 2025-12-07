/**
 * 오늘의 흐름 페이지 뷰
 * 바인더 노트 형식의 메모 작성 및 관리 화면
 */

import { BookSelector } from '../../components/book-selector.js';
import { CalendarModal } from '../../components/calendar-modal.js';
import { MemoCard } from '../../components/memo-card.js';
import { MemoEditor } from '../../components/memo-editor.js';
import { ROUTES } from '../../constants/routes.js';
import { memoService } from '../../services/memo-service.js';
import { webSocketService } from '../../services/websocket-service.js';
import { authHelper } from '../../utils/auth-helper.js';
import { FooterView } from '../common/footer.js';
import { HeaderView } from '../common/header.js';

class FlowView {
  constructor() {
    // DOM 요소
    this.loadingSpinner = null;
    this.currentDateEl = null;
    this.btnCalendar = null;
    this.groupingToggle = null;
    this.tagCategoryToggle = null;
    this.tagCategorySection = null;
    this.inlineCalendarSection = null;
    this.inlineCalendarContainer = null;
    this.memoList = null;
    this.memoEditor = null;
    this.memoInput = null;
    this.tagChips = null;
    this.btnSaveMemo = null;
    this.btnSelectBook = null;
    this.bookSelectorContainer = null;
    this.memoInputContainer = null;
    this.selectedBookInfo = null;
    this.selectedBookTitle = null;
    this.selectedBookAuthor = null;
    this.emptyState = null;
    this.btnCloseBook = null;
    this.closeBookModal = null;
    this.closeBookModalClose = null;
    this.closeBookCancel = null;
    this.closeBookConfirm = null;
    this.closeBookProgress = null;
    this.closeBookTotalPages = null;
    
    // 상태
    this.currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    this.currentGrouping = 'SESSION'; // SESSION, BOOK, TAG
    this.currentTagCategory = 'TYPE'; // TYPE, TOPIC
    this.selectedBookId = null; // 선택된 책의 userBookId
    this.selectedBook = null; // 선택된 책 정보
    this.memos = []; // 현재 표시 중인 메모 목록
    this.userShelfBooks = []; // 읽는 중인 책 목록 (Reading, AlmostFinished)
    this.editingMemoId = null; // 수정 중인 메모 ID
    this.isProcessingMemoClose = false; // 메모 닫기 처리 중 여부
    this.suppressNextEditorInsert = false; // 일시적으로 다음 에디터 삽입을 억제
    this.isCalendarVisible = false; // 인라인 캘린더 표시 여부
    this.calendarYear = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth() + 1; // 1-12
    this.calendarMemoDates = []; // 메모가 작성된 날짜 목록
    
    // 페이지네이션 상태
    this.currentPage = 1; // 현재 페이지 (1부터 시작)
    this.memosPerPage = 5; // 페이지당 메모 개수
    this.totalPages = 1; // 전체 페이지 수
    
    // WebSocket 실시간 동기화 상태
    this.wsConnected = false; // WebSocket 연결 상태
    this.wsUpdateDebounceTimer = null; // 업데이트 debounce 타이머
    this.wsUpdateDebounceDelay = 500; // debounce 딜레이 (ms)
    
    // 컴포넌트
    this.calendarModal = null;
    this.bookSelector = null;
    this.memoEditor = null;
    
    // 이벤트 구독 관리
    this.unsubscribers = [];
    
    // 이벤트 리스너 참조 (정리용)
    this.eventListeners = [];
    // pending memo create data when user clicks save without selecting a book
    this.pendingCreateMemoData = null;
    this.waitingForCreate = false; // waiting for server create response

    // bind helper
    this.generateUUID = this.generateUUID.bind(this);
    this.generateTempNumericId = this.generateTempNumericId.bind(this);
    
    // 날짜 변경 감지 인터벌 ID
    this.dateChangeIntervalId = null;
    
    // 이벤트 핸들러 바인딩 (destroy에서 제거하기 위해)
    this.handleCalendarClick = this.handleCalendarClick.bind(this);
    this.handleInlineCalendarClick = this.handleInlineCalendarClick.bind(this);
    this.handleGroupingToggleClick = this.handleGroupingToggleClick.bind(this);
    this.handleTagCategoryToggleClick = this.handleTagCategoryToggleClick.bind(this);
    this.handleSelectBookClick = this.handleSelectBookClick.bind(this);
    this.handleHomeClick = this.handleHomeClick.bind(this);
    this.handleMemoListClick = this.handleMemoListClick.bind(this);
    
    // 보호된 페이지: 인증 확인 (비동기)
    this.initAuth();
  }

  /**
   * Generate RFC4122 v4 UUID (simple implementation)
   * @returns {string}
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Generate an unpredictable numeric temporary id (includes decimal part)
   * Example: 1691372345123.348957
   * @returns {number}
   */
  generateTempNumericId() {
    // Use high-resolution timestamp (ms) with extra random suffix to reduce collision chance
    // Return an integer (no decimal) so JSON number is deserialized as Long on server
    const suffix = Math.floor(Math.random() * 1000); // 0-999
    return Math.floor(Date.now() * 1000) + suffix; // e.g., 169...000 + suffix
  }

  /**
   * 인증 확인 및 초기화
   */
  async initAuth() {
    const isAuthenticated = await authHelper.checkAuth();
    if (!isAuthenticated) {
      return;
    }
    
    this.init();
  }

  /**
   * 초기화
   */
  init() {
    // 헤더와 푸터 렌더링
    new HeaderView('header');
    new FooterView('footer');
    
    // DOM 요소 선택
    this.loadingSpinner = document.getElementById('loading-spinner');
    this.currentDateEl = document.getElementById('current-date');
    this.btnCalendar = document.getElementById('btn-calendar');
    this.groupingToggle = document.getElementById('grouping-toggle');
    this.tagCategoryToggle = document.getElementById('tag-category-tabs');
    this.tagCategorySection = document.getElementById('tag-category-section');
    this.inlineCalendarSection = document.getElementById('inline-calendar-section');
    this.inlineCalendarContainer = document.getElementById('inline-calendar-container');
    this.memoList = document.getElementById('memo-list');
    this.memoEditor = document.getElementById('memo-editor');
    this.memoInput = document.getElementById('memo-input');
    this.tagChips = document.getElementById('tag-chips');
    this.btnSelectBook = document.getElementById('btn-select-book');
    this.memoInputContainer = document.getElementById('memo-input-container');
    this.selectedBookInfo = document.getElementById('selected-book-info');
    this.selectedBookTitle = document.getElementById('selected-book-title');
    this.selectedBookAuthor = document.getElementById('selected-book-author');
    this.btnCloseBook = document.getElementById('btn-close-book');
    this.closeBookModal = document.getElementById('close-book-modal');
    this.closeBookModalClose = document.getElementById('close-book-modal-close');
    this.closeBookCancel = document.getElementById('close-book-cancel');
    this.closeBookConfirm = document.getElementById('close-book-confirm');
    this.closeBookProgress = document.getElementById('close-book-progress');
    this.closeBookTotalPages = document.getElementById('close-book-total-pages');
    this.closeBookFinishedFields = document.getElementById('close-book-finished-fields');
    this.closeBookFinishedDate = document.getElementById('close-book-finished-date');
    this.closeBookRatingStars = document.getElementById('close-book-rating-stars');
    this.closeBookRating = document.getElementById('close-book-rating');
    this.closeBookReview = document.getElementById('close-book-review');
    this.emptyState = document.getElementById('empty-state');
    this.flowContent = document.querySelector('.flow-content'); // 메모 에디터 임시 보관용
    this.memoPagination = document.getElementById('memo-pagination');
    this.btnPrevPage = document.getElementById('btn-prev-page');
    this.btnNextPage = document.getElementById('btn-next-page');
    this.paginationInfo = document.getElementById('pagination-info');
    
    if (!this.memoList || !this.memoEditor) {
      console.error('Required DOM elements not found');
      return;
    }
    
    // 이벤트 리스너 등록
    this.setupEventListeners();
    
    // 캘린더 모달 초기화
    this.calendarModal = new CalendarModal('calendar-modal');
    
    // 책 선택 모달 초기화
    this.bookSelector = new BookSelector('book-selector-modal');
    
    // 메모 에디터 초기화
    this.memoEditor = new MemoEditor('memo-editor');
    this.memoEditor.setOnSave((memoData) => {
      this.handleMemoSave(memoData);
    });
    this.memoEditor.setOnCancel((memoData) => {
      this.handleMemoCancel(memoData);
    });
    this.memoEditor.setOnInput((memoData) => {
      this.handleMemoInput(memoData);
    });
    
    // WebSocket 이벤트 리스너 설정
    this.setupWebSocketListeners();
    
    // 초기 데이터 로드
    this.loadMemoFlow();
    
    // FlowView 진입 시 WebSocket 연결
    this.connectWebSocket();
    
    // 날짜 변경 감지 (1분마다 확인)
    this.startDateChangeDetection();
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    // 캘린더 버튼 (인라인 캘린더 토글)
    if (this.btnCalendar) {
      this.btnCalendar.addEventListener('click', this.handleCalendarClick);
      this.eventListeners.push({ element: this.btnCalendar, event: 'click', handler: this.handleCalendarClick });
    }
    
    // 인라인 캘린더 이벤트 위임
    if (this.inlineCalendarContainer) {
      this.inlineCalendarContainer.addEventListener('click', this.handleInlineCalendarClick);
      this.eventListeners.push({ element: this.inlineCalendarContainer, event: 'click', handler: this.handleInlineCalendarClick });
    }
    
    // 그룹화 선택
    if (this.groupingToggle) {
      this.groupingToggle.addEventListener('click', this.handleGroupingToggleClick);
      this.eventListeners.push({ element: this.groupingToggle, event: 'click', handler: this.handleGroupingToggleClick });
    }
    
    // 태그 대분류 선택
    if (this.tagCategoryToggle) {
      this.tagCategoryToggle.addEventListener('click', this.handleTagCategoryToggleClick);
      this.eventListeners.push({ element: this.tagCategoryToggle, event: 'click', handler: this.handleTagCategoryToggleClick });
    }
    
    // 책 선택 버튼
    if (this.btnSelectBook) {
      this.btnSelectBook.addEventListener('click', this.handleSelectBookClick);
      this.eventListeners.push({ element: this.btnSelectBook, event: 'click', handler: this.handleSelectBookClick });
    }
    
    // 책 덮기 버튼
    if (this.btnCloseBook) {
      this.btnCloseBook.addEventListener('click', this.handleCloseBookClick);
      this.eventListeners.push({ element: this.btnCloseBook, event: 'click', handler: this.handleCloseBookClick });
    }
    
    // 책 덮기 모달 이벤트 리스너
    if (this.closeBookModalClose) {
      this.closeBookModalClose.addEventListener('click', () => this.hideCloseBookModal());
      this.eventListeners.push({ element: this.closeBookModalClose, event: 'click', handler: () => this.hideCloseBookModal() });
    }
    
    if (this.closeBookCancel) {
      this.closeBookCancel.addEventListener('click', () => this.hideCloseBookModal());
      this.eventListeners.push({ element: this.closeBookCancel, event: 'click', handler: () => this.hideCloseBookModal() });
    }
    
    if (this.closeBookConfirm) {
      this.closeBookConfirm.addEventListener('click', this.handleCloseBookConfirm);
      this.eventListeners.push({ element: this.closeBookConfirm, event: 'click', handler: this.handleCloseBookConfirm });
    }
    
    // 모달 외부 클릭 시 닫기
    if (this.closeBookModal) {
      this.closeBookModal.addEventListener('click', (e) => {
        if (e.target === this.closeBookModal) {
          this.hideCloseBookModal();
        }
      });
    }
    
    // 메모 저장은 memo-editor 컴포넌트에서 처리
    
    // 홈으로 버튼
    const btnHome = document.getElementById('btn-home');
    if (btnHome) {
      btnHome.addEventListener('click', this.handleHomeClick);
      this.eventListeners.push({ element: btnHome, event: 'click', handler: this.handleHomeClick });
    }
    
    // 메모 카드 이벤트 위임 (수정/삭제)
    if (this.memoList) {
      this.memoList.addEventListener('click', this.handleMemoListClick);
      this.eventListeners.push({ element: this.memoList, event: 'click', handler: this.handleMemoListClick });
    }
    
    // 페이지네이션 버튼 이벤트
    if (this.btnPrevPage) {
      this.btnPrevPage.addEventListener('click', () => this.goToPage(this.currentPage - 1));
    }
    if (this.btnNextPage) {
      this.btnNextPage.addEventListener('click', () => this.goToPage(this.currentPage + 1));
    }
  }

  /**
   * 캘린더 버튼 클릭 처리
   */
  handleCalendarClick() {
    this.toggleInlineCalendar();
  }

  /**
   * 인라인 캘린더 클릭 이벤트 처리
   * @param {Event} e - 클릭 이벤트
   */
  handleInlineCalendarClick(e) {
    const prevBtn = e.target.closest('.calendar-nav-btn.prev');
    const nextBtn = e.target.closest('.calendar-nav-btn.next');
    const dayEl = e.target.closest('.calendar-day');
    
    if (prevBtn) {
      e.preventDefault();
      this.navigateCalendarMonth(-1);
    } else if (nextBtn) {
      e.preventDefault();
      this.navigateCalendarMonth(1);
    } else if (dayEl) {
      const date = dayEl.dataset.date;
      if (date) {
        this.handleCalendarDateClick(date);
      }
    }
  }

  /**
   * 그룹화 토글 클릭 이벤트 처리
   * @param {Event} e - 클릭 이벤트
   */
  handleGroupingToggleClick(e) {
    const btn = e.target.closest('.grouping-btn');
    if (btn) {
      const grouping = btn.dataset.grouping;
      this.handleGroupingChange(grouping);
    }
  }

  /**
   * 태그 대분류 토글 클릭 이벤트 처리
   * @param {Event} e - 클릭 이벤트
   */
  handleTagCategoryToggleClick(e) {
    const tab = e.target.closest('.tag-category-tab');
    if (tab) {
      const category = tab.dataset.category;
      this.handleTagCategoryChange(category);
      // 메모 에디터와는 연동하지 않음 (별개의 작업)
    }
  }

  /**
   * 책 선택 버튼 클릭 처리
   */
  handleSelectBookClick() {
    this.showBookSelector();
  }

  /**
   * 홈으로 버튼 클릭 처리
   * @param {Event} e - 클릭 이벤트
   */
  handleHomeClick(e) {
    e.preventDefault();
    window.location.href = ROUTES.HOME;
  }

  /**
   * 메모 리스트 클릭 이벤트 처리
   * @param {Event} e - 클릭 이벤트
   */
  handleMemoListClick(e) {
    const editBtn = e.target.closest('.memo-edit-btn');
    const deleteBtn = e.target.closest('.memo-delete-btn');
    
    if (editBtn) {
      const memoId = parseInt(editBtn.dataset.memoId);
      this.handleMemoEdit(memoId);
    } else if (deleteBtn) {
      const memoId = parseInt(deleteBtn.dataset.memoId);
      this.handleMemoDelete(memoId);
    }
  }

  /**
   * 오늘의 흐름 로드 (WebSocket 기반, 날짜/그룹 변경 시 호출)
   * 1) cacheUserId + date로 UserShelfBookDto 조회
   * 2) 각 UserShelfBookDto의 cacheUserShelfBookId로 MemoDto 조회
   * 3) getTodayFlow 형태로 변환하여 렌더링
   * @param {string} [date] - 조회할 날짜 (YYYY-MM-DD, 기본값: 현재 날짜)
   * @param {string} [grouping] - 그룹화 방식 (SESSION, BOOK, TAG, 기본값: this.currentGrouping)
   */
  async loadMemoFlow(date = null, grouping = null) {
    this.setLoading(true);
    this.hideEmptyState();
    
    const targetDate = date || this.currentDate;
    const targetGrouping = grouping || this.currentGrouping;
    
    // 상태 업데이트
    this.currentDate = targetDate;
    this.currentGrouping = targetGrouping;
    
    // 날짜 표시 업데이트
    this.updateDateDisplay();
    
    // REST API로 직접 데이터 로드
    console.log('[FlowView] REST API로 메모 로드');
    await this.loadMemoFlowViaREST(targetDate, targetGrouping);
  }
  
  /**
   * REST API 기반 메모 로드 (폴백용)
   */
  async loadMemoFlowViaREST(targetDate, targetGrouping) {
    try {
      const params = {
        date: targetDate,
        sortBy: targetGrouping,
      };
      
      if (targetGrouping === 'TAG') {
        params.tagCategory = this.currentTagCategory;
      }
      
      console.log('[FlowView] REST API 메모 로드:', params);
      const response = await memoService.getTodayFlow(params);
      this.renderMemos(response);
      
    } catch (error) {
      console.error('[FlowView] REST API 메모 로드 오류:', error);
      
      if (this.selectedBookId && this.selectedBook) {
        this.renderMemos({ 
          memosByBook: {},
          memosByTag: {},
          totalMemoCount: 0
        });
      } else {
        this.showEmptyState();
        if (this.memoInputContainer) {
          this.memoInputContainer.style.display = 'none';
        }
      }
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * 날짜 표시 업데이트
   */
  updateDateDisplay() {
    if (this.currentDateEl) {
      const date = new Date(this.currentDate);
      const formattedDate = date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });
      this.currentDateEl.textContent = formattedDate;
    }
  }

  /**
   * 메모 렌더링
   * @param {Object} response - TodayFlowResponse
   */
  renderMemos(response) {
    if (!this.memoList) {
      console.error('[FlowView] memoList 요소를 찾을 수 없습니다.');
      return;
    }
    
    // 메모 에디터 보호: innerHTML = '' 실행 전에 memoList 밖으로 임시 이동
    let memoEditorWasInList = false;
    let memoEditorOriginalParent = null;
    
    if (this.memoEditor && this.memoEditor.container) {
      const parent = this.memoEditor.container.parentNode;
      // memoList 내부 또는 그 자식 요소에 있는지 확인
      if (parent && (parent === this.memoList || this.memoList.contains(parent))) {
        memoEditorWasInList = true;
        memoEditorOriginalParent = parent;
        
        // DOM에서 제거하지 않고 flow-content로 임시 이동 (이벤트 리스너 유지)
        if (this.flowContent && this.memoEditor.container.parentNode !== this.flowContent) {
          this.flowContent.appendChild(this.memoEditor.container);
          this.memoEditor.container.style.display = 'none'; // 임시로 숨김
        }
      }
    }
    
    // 기존 메모 섹션만 제거 (메모 에디터는 이미 flow-content로 이동됨)
    this.memoList.innerHTML = '';
    
    // api-client.js가 이미 response.data를 반환하므로 response 자체가 data임
    if (!response) {
      this.totalPages = 1;
      this.currentPage = 1;
      this.updatePagination();
      
      // 선택된 책이 있으면 빈 섹션 생성 및 메모 작성 UI 표시
      if (this.selectedBookId && this.selectedBook) {
        this.createEmptyBookSectionWithEditor();
        this.hideEmptyState();
      } else {
        this.showEmptyState();
        // 메모 에디터 복원
        if (memoEditorWasInList) {
          this.restoreMemoEditor();
        }
      }
      return;
    }
    
    // response가 이미 data 부분이므로 직접 사용
    const { memosByBook, memosByTag, totalMemoCount } = response;
    
    if (totalMemoCount === 0) {
      this.totalPages = 1;
      this.currentPage = 1;
      this.updatePagination();
      
      // 선택된 책이 있으면 빈 섹션 생성 및 메모 작성 UI 표시
      if (this.selectedBookId && this.selectedBook) {
        this.createEmptyBookSectionWithEditor();
        this.hideEmptyState();
      } else {
        this.showEmptyState();
        // 메모 에디터 복원
        if (memoEditorWasInList) {
          this.restoreMemoEditor();
        }
      }
      return;
    }
    
    // 그룹화 방식에 따라 렌더링
    if (this.currentGrouping === 'TAG' && memosByTag) {
      this.renderMemosByTag(memosByTag);
    } else if (this.currentGrouping === 'SESSION' && memosByBook) {
      // 섹션별 그룹화: 독서 세션 순서로 그룹화
      this.renderMemosBySession(memosByBook);
    } else if (memosByBook) {
      // 책별 그룹화: 책별로 그룹화
      this.renderMemosByBook(memosByBook);
    }
    
    // renderMemosByBook에서 마지막 페이지인 경우에만 메모 에디터를 삽입하므로
    // 여기서는 restoreMemoEditor를 호출하지 않음
    
    this.hideEmptyState();
  }


  /**
   * 섹션별 메모 렌더링 (페이지네이션 적용)
   * 독서 세션 순서로 그룹화: "책 선택하기 -> 책 덮기"가 하나의 섹션
   * @param {Object} memosByBook - 책별 메모 그룹 (백엔드에서 받은 데이터)
   */
  renderMemosBySession(memosByBook) {
    // 1. 모든 메모를 하나의 배열로 수집
    const allMemos = [];
    Object.values(memosByBook).forEach((bookGroup) => {
      if (bookGroup.memos && Array.isArray(bookGroup.memos)) {
        bookGroup.memos.forEach(memo => {
          // 책 정보 추가
          memo.bookId = bookGroup.bookId || memo.userBookId;
          memo.bookTitle = bookGroup.bookTitle || memo.bookTitle;
          allMemos.push(memo);
        });
      }
    });
    
    // 2. 모든 메모를 시간 순으로 정렬 (오래된 메모부터)
    allMemos.sort((a, b) => {
      const timeA = new Date(a.memoStartTime || a.createdAt);
      const timeB = new Date(b.memoStartTime || b.createdAt);
      return timeA - timeB;
    });
    
    // 3. 독서 세션별로 그룹화
    // 세션 구분: 책 ID가 변경되면 새로운 세션
    const sessions = [];
    let currentSession = null;
    
    allMemos.forEach((memo, index) => {
      const bookId = memo.bookId || memo.userBookId;
      
      // 첫 메모이거나 책 ID가 변경된 경우 새로운 세션 시작
      if (index === 0 || (currentSession && currentSession.bookId !== bookId)) {
        currentSession = {
          bookId: bookId,
          bookTitle: memo.bookTitle || '제목 없음',
          memos: [],
          firstMemoTime: new Date(memo.memoStartTime || memo.createdAt)
        };
        sessions.push(currentSession);
      }
      
      // 현재 세션에 메모 추가
      currentSession.memos.push(memo);
    });
    
    // 메모 배열 저장
    this.memos = allMemos;
    
    // 4. 전체 페이지 수 계산
    const previousTotalPages = this.totalPages;
    this.totalPages = Math.max(1, Math.ceil(allMemos.length / this.memosPerPage));
    
    // 새 메모가 추가되어 페이지 수가 증가했고, 이전에 마지막 페이지에 있었다면 새 마지막 페이지로 이동
    if (this.totalPages > previousTotalPages && this.currentPage === previousTotalPages) {
      this.currentPage = this.totalPages;
    }
    
    // 현재 페이지가 전체 페이지를 초과하면 마지막 페이지로 조정
    // 또는 메모 저장 후 항상 마지막 페이지로 이동하도록 함 (currentPage === 999인 경우)
    if (this.currentPage > this.totalPages || this.currentPage === 999) {
      this.currentPage = this.totalPages;
    }
    
    // 5. 현재 페이지의 메모 범위 계산
    const startIndex = (this.currentPage - 1) * this.memosPerPage;
    const endIndex = startIndex + this.memosPerPage;
    
    // 6. 현재 페이지에 표시할 세션 결정
    // 세션 단위로 페이지네이션 처리
    let currentMemoCount = 0;
    const sessionsForPage = [];
    
    for (const session of sessions) {
      const sessionStartIndex = currentMemoCount;
      const sessionEndIndex = currentMemoCount + session.memos.length;
      
      // 현재 페이지 범위와 겹치는 세션인지 확인
      if (sessionEndIndex > startIndex && sessionStartIndex < endIndex) {
        // 현재 페이지에 표시할 메모만 필터링
        const pageStartInSession = Math.max(0, startIndex - sessionStartIndex);
        const pageEndInSession = Math.min(session.memos.length, endIndex - sessionStartIndex);
        const memosForPage = session.memos.slice(pageStartInSession, pageEndInSession);
        
        if (memosForPage.length > 0) {
          sessionsForPage.push({
            bookId: session.bookId,
            bookTitle: session.bookTitle,
            memos: memosForPage
          });
        }
      }
      
      currentMemoCount += session.memos.length;
      
      // 이미 현재 페이지 범위를 넘어섰으면 중단
      if (sessionEndIndex >= endIndex) {
        break;
      }
    }
    
    if (sessionsForPage.length === 0) {
      // 메모가 없어도 선택된 책이 있고 마지막 페이지라면 빈 섹션 생성
      if (this.currentPage === this.totalPages && this.selectedBookId) {
        this.createEmptyBookSectionWithEditor();
        this.updatePagination();
        return;
      }
      this.showEmptyState();
      this.updatePagination();
      return;
    }
    
    // 7. 각 세션별로 섹션 컨테이너 생성 및 렌더링
    sessionsForPage.forEach((session) => {
      // 책 섹션 컨테이너 생성 (세션 = 책 섹션)
      const bookSection = this.renderBookSection(session, session.memos);
      const sectionElement = document.createRange().createContextualFragment(bookSection);
      this.memoList.appendChild(sectionElement.firstElementChild);
    });
    
    // 8. 마지막 페이지이고 선택된 책이 있는 경우에만 메모 작성 UI 삽입
    if (this.currentPage === this.totalPages && this.selectedBookId) {
      // 선택된 책의 마지막 세션 찾기
      const selectedBookSessions = sessions.filter(session => 
        session.bookId === this.selectedBookId || 
        String(session.bookId) === String(this.selectedBookId)
      );
      
      if (selectedBookSessions.length > 0) {
        // 선택된 책의 마지막 세션 (시간상 가장 마지막)
        const lastSession = selectedBookSessions[selectedBookSessions.length - 1];
        const lastMemo = lastSession.memos[lastSession.memos.length - 1];
        
        // 마지막 메모가 현재 페이지에 있는지 확인
        const lastMemoIndex = allMemos.findIndex(memo => memo.id === lastMemo.id);
        const isLastMemoInCurrentPage = lastMemoIndex >= startIndex && lastMemoIndex < endIndex;
        
        if (isLastMemoInCurrentPage) {
          // 선택된 책의 메모 섹션 찾기 (현재 페이지의 마지막 세션)
          const selectedBookSection = Array.from(this.memoList.querySelectorAll('.memo-book-section'))
            .filter(section => section.dataset.bookId === String(this.selectedBookId))
            .pop(); // 마지막 섹션
          
          if (selectedBookSection) {
            this.insertMemoEditorIntoSection(selectedBookSection);
          }
        } else {
          // 마지막 메모가 현재 페이지에 없으면 메모 작성 UI 숨김
          this.hideMemoEditor();
        }
      } else {
        // 선택된 책의 메모가 없으면 빈 섹션 생성
        this.createEmptyBookSectionWithEditor();
      }
    } else {
      // 마지막 페이지가 아니거나 선택된 책이 없으면 메모 작성 UI 숨김
      this.hideMemoEditor();
    }
    
    // 페이지네이션 UI 업데이트
    this.updatePagination();
  }

  /**
   * 책별 메모 렌더링 (페이지네이션 적용)
   * 책별로 그룹화: 같은 책의 모든 메모를 하나의 그룹으로 묶음
   * @param {Object} memosByBook - 책별 메모 그룹
   */
  renderMemosByBook(memosByBook) {
    // 1. 먼저 책별로 그룹화
    const bookGroups = [];
    Object.values(memosByBook).forEach((bookGroup) => {
      if (bookGroup.memos && Array.isArray(bookGroup.memos)) {
        // 각 책 그룹 내부에서 시간 순으로 정렬 (2차 기준: 시간 순)
        const sortedMemos = [...bookGroup.memos].sort((a, b) => {
          const timeA = new Date(a.memoStartTime || a.createdAt);
          const timeB = new Date(b.memoStartTime || b.createdAt);
          return timeA - timeB; // 오래된 메모부터
        });
        
        // 책 정보 추가
        sortedMemos.forEach(memo => {
          memo.bookId = bookGroup.bookId || memo.userBookId;
          memo.bookTitle = bookGroup.bookTitle || memo.bookTitle;
        });
        
        // 해당 날짜에 첫 메모가 작성된 시간 찾기 (책 그룹 배치 순서 결정용)
        const firstMemoTime = sortedMemos.length > 0 
          ? new Date(sortedMemos[0].memoStartTime || sortedMemos[0].createdAt)
          : new Date(0);
        
        bookGroups.push({
          bookId: bookGroup.bookId,
          bookTitle: bookGroup.bookTitle || '제목 없음',
          memos: sortedMemos,
          firstMemoTime: firstMemoTime // 책 그룹 배치 순서 결정용
        });
      }
    });
    
    // 2. 책 그룹의 배치 순서는 "해당 날짜에 첫 메모가 작성된 시간"을 기준으로 정렬 (1차 기준: 책별 그룹화)
    bookGroups.sort((a, b) => {
      return a.firstMemoTime - b.firstMemoTime; // 첫 메모가 먼저 작성된 책부터
    });
    
    // 3. 모든 메모를 하나의 배열로 수집 (페이지네이션 계산용)
    const allMemos = [];
    bookGroups.forEach(bookGroup => {
      allMemos.push(...bookGroup.memos);
    });
    
    // 메모 배열 저장
    this.memos = allMemos;
    
    // 4. 전체 페이지 수 계산
    const previousTotalPages = this.totalPages;
    this.totalPages = Math.max(1, Math.ceil(allMemos.length / this.memosPerPage));
    
    // 새 메모가 추가되어 페이지 수가 증가했고, 이전에 마지막 페이지에 있었다면 새 마지막 페이지로 이동
    if (this.totalPages > previousTotalPages && this.currentPage === previousTotalPages) {
      this.currentPage = this.totalPages;
    }
    
    // 현재 페이지가 전체 페이지를 초과하면 마지막 페이지로 조정
    // 또는 메모 저장 후 항상 마지막 페이지로 이동하도록 함 (currentPage === 999인 경우)
    if (this.currentPage > this.totalPages || this.currentPage === 999) {
      this.currentPage = this.totalPages;
    }
    
    // 5. 현재 페이지의 메모 범위 계산
    const startIndex = (this.currentPage - 1) * this.memosPerPage;
    const endIndex = startIndex + this.memosPerPage;
    
    // 6. 현재 페이지에 표시할 책 그룹 결정
    // 책 그룹 단위로 페이지네이션 처리
    let currentMemoCount = 0;
    const bookGroupsForPage = [];
    
    for (const bookGroup of bookGroups) {
      const bookGroupStartIndex = currentMemoCount;
      const bookGroupEndIndex = currentMemoCount + bookGroup.memos.length;
      
      // 현재 페이지 범위와 겹치는 책 그룹인지 확인
      if (bookGroupEndIndex > startIndex && bookGroupStartIndex < endIndex) {
        // 현재 페이지에 표시할 메모만 필터링
        const pageStartInGroup = Math.max(0, startIndex - bookGroupStartIndex);
        const pageEndInGroup = Math.min(bookGroup.memos.length, endIndex - bookGroupStartIndex);
        const memosForPage = bookGroup.memos.slice(pageStartInGroup, pageEndInGroup);
        
        if (memosForPage.length > 0) {
          bookGroupsForPage.push({
            bookId: bookGroup.bookId,
            bookTitle: bookGroup.bookTitle,
            memos: memosForPage
          });
        }
      }
      
      currentMemoCount += bookGroup.memos.length;
      
      // 이미 현재 페이지 범위를 넘어섰으면 중단
      if (bookGroupEndIndex >= endIndex) {
        break;
      }
    }
    
    if (bookGroupsForPage.length === 0) {
      // 메모가 없어도 선택된 책이 있고 마지막 페이지라면 빈 섹션 생성
      if (this.currentPage === this.totalPages && this.selectedBookId) {
        this.createEmptyBookSectionWithEditor();
        this.updatePagination();
        return;
      }
      this.showEmptyState();
      this.updatePagination();
      return;
    }
    
    // 7. 각 책 그룹별로 섹션 컨테이너 생성 및 렌더링
    bookGroupsForPage.forEach((bookGroup) => {
      // 책 섹션 컨테이너 생성
      const bookSection = this.renderBookSection(bookGroup, bookGroup.memos);
      const sectionElement = document.createRange().createContextualFragment(bookSection);
      this.memoList.appendChild(sectionElement.firstElementChild);
    });
    
    // 마지막 페이지이고 선택된 책이 있는 경우에만 메모 작성 UI 삽입
    if (this.currentPage === this.totalPages && this.selectedBookId) {
      // 선택된 책의 그룹 찾기
      const selectedBookGroup = bookGroups.find(group => 
        group.bookId === this.selectedBookId || 
        String(group.bookId) === String(this.selectedBookId)
      );
      
      if (selectedBookGroup && selectedBookGroup.memos.length > 0) {
        // 선택된 책의 마지막 메모 찾기 (이미 시간순으로 정렬되어 있음)
        const lastMemo = selectedBookGroup.memos[selectedBookGroup.memos.length - 1];
        
        // 마지막 메모가 현재 페이지에 있는지 확인
        const lastMemoIndex = allMemos.findIndex(memo => memo.id === lastMemo.id);
        const isLastMemoInCurrentPage = lastMemoIndex >= startIndex && lastMemoIndex < endIndex;
        
        if (isLastMemoInCurrentPage) {
          // 선택된 책의 메모 섹션 찾기
          const selectedBookSection = Array.from(this.memoList.querySelectorAll('.memo-book-section')).find(
            section => section.dataset.bookId === String(this.selectedBookId)
          );
          
          if (selectedBookSection) {
            this.insertMemoEditorIntoSection(selectedBookSection);
          }
        } else {
          // 마지막 메모가 현재 페이지에 없으면 메모 작성 UI 숨김
          this.hideMemoEditor();
        }
      } else {
        // 선택된 책의 메모가 없으면 빈 섹션 생성
        this.createEmptyBookSectionWithEditor();
      }
    } else {
      // 마지막 페이지가 아니거나 선택된 책이 없으면 메모 작성 UI 숨김
      this.hideMemoEditor();
    }
    
    // 페이지네이션 UI 업데이트
    this.updatePagination();
  }
  
  /**
   * 책 섹션 전체 렌더링 (도서명 + 메모 그리드)
   * @param {Object} bookGroup - 책 그룹 정보
   * @param {Array} sortedMemos - 정렬된 메모 배열
   * @returns {string} HTML 문자열
   */
  renderBookSection(bookGroup, sortedMemos) {
    const bookTitle = bookGroup.bookTitle || sortedMemos[0]?.bookTitle || '제목 없음';
    const bookId = bookGroup.bookId || sortedMemos[0]?.userBookId;
    
    // 도서명 헤더
    let html = `
      <div class="memo-book-section" data-book-id="${bookId}">
        <div class="memo-section-header">
          <h3 class="memo-section-title">${this.escapeHtml(bookTitle)}</h3>
        </div>
        <div class="memo-section-grid">
    `;
    
    // 메모 카드 렌더링
    sortedMemos.forEach((memo) => {
      html += MemoCard.render(memo);
    });
    
    html += `
        </div>
      </div>
    `;
    
    return html;
  }

  /**
   * 메모 작성 UI 숨김
   */
  hideMemoEditor() {
    if (this.memoEditor && this.memoEditor.container) {
      const parent = this.memoEditor.container.parentNode;
      // 메모 섹션 내부에 있으면 flow-content로 이동하고 숨김
      if (parent && (parent === this.memoList || this.memoList.contains(parent))) {
        if (this.flowContent && this.memoEditor.container.parentNode !== this.flowContent) {
          this.flowContent.appendChild(this.memoEditor.container);
        }
        this.memoEditor.container.style.display = 'none';
      }
      // 입력 컨테이너 숨김
      if (this.memoInputContainer) {
        this.memoInputContainer.style.display = 'none';
      }
    }
  }
  
  /**
   * 메모 섹션 내부에 입력 컴포넌트 삽입
   * @param {HTMLElement} sectionNode - 메모 섹션 DOM 노드
   */
  insertMemoEditorIntoSection(sectionNode) {
    if (!this.memoEditor || !this.memoEditor.container || !sectionNode) return;

    // If insertion is being suppressed (e.g., just closed), skip one insertion
    if (this.suppressNextEditorInsert) {
      this.suppressNextEditorInsert = false;
      return;
    }

    const memoGrid = sectionNode.querySelector('.memo-section-grid');
    if (!memoGrid) return;

    // 기존에 다른 곳에 있던 입력 컴포넌트 제거 (다른 섹션에 있을 수 있음)
    const existingEditor = this.memoList.querySelector('.memo-section-grid .memo-editor');
    if (existingEditor && existingEditor !== this.memoEditor.container) {
      existingEditor.remove();
    }

    // 기존 메모 에디터를 메모 그리드로 직접 이동
    if (this.memoEditor.container.parentNode !== memoGrid) {
      this.memoEditor.container.style.display = 'block';
      memoGrid.appendChild(this.memoEditor.container);
    }
    
    // 입력 컨테이너 표시
    if (this.memoInputContainer && this.selectedBookId) {
      this.memoInputContainer.style.display = 'block';
    }
  }

  /**
   * 빈 책 섹션 생성 (첫 메모 작성용)
   */
  createEmptyBookSectionWithEditor() {
    if (!this.selectedBook || !this.selectedBookId) return;

    const bookTitle = this.selectedBook.title || '제목 없음';
    const bookId = this.selectedBookId;

    // 빈 책 섹션 HTML 생성
    const sectionHtml = `
      <div class="memo-book-section" data-book-id="${bookId}">
        <div class="memo-section-header">
          <h3 class="memo-section-title">${this.escapeHtml(bookTitle)}</h3>
        </div>
        <div class="memo-section-grid">
        </div>
      </div>
    `;

    const sectionElement = document.createRange().createContextualFragment(sectionHtml);
    const sectionNode = this.memoList.appendChild(sectionElement.firstElementChild);
    
    // 입력 컴포넌트 삽입
    this.insertMemoEditorIntoSection(sectionNode);
  }
  
  /**
   * 메모 에디터를 올바른 위치에 복원
   */
  restoreMemoEditor() {
    if (!this.memoEditor || !this.memoEditor.container) return;
    
    // 선택된 책이 있는 경우에만 메모 섹션 내부로 이동
    if (this.selectedBookId) {
      // 선택된 책의 메모 섹션 찾기
      const selectedBookSection = Array.from(this.memoList.querySelectorAll('.memo-book-section')).find(
        section => section.dataset.bookId === String(this.selectedBookId)
      );
      
      if (selectedBookSection) {
        this.insertMemoEditorIntoSection(selectedBookSection);
      } else {
        // 선택된 책의 섹션이 없으면 빈 섹션 생성
        this.createEmptyBookSectionWithEditor();
      }
    } else {
      // 선택된 책이 없으면 flow-content의 원래 위치로 복원 (숨김 상태 유지)
      if (this.flowContent && this.memoEditor.container.parentNode !== this.flowContent) {
        this.flowContent.appendChild(this.memoEditor.container);
      }
      this.memoEditor.container.style.display = 'none';
    }
  }
  
  /**
   * HTML 이스케이프
   * @param {string} text - 이스케이프할 텍스트
   * @returns {string} 이스케이프된 텍스트
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 태그별 메모 렌더링 (페이지네이션 적용)
   * @param {Object} memosByTag - 태그별 메모 그룹
   */
  renderMemosByTag(memosByTag) {
    // 모든 메모를 하나의 배열로 수집 (페이지네이션 계산용)
    const allMemos = [];
    const tagSectionsData = []; // 태그 섹션 데이터 저장
    
    // 태그별로 섹션을 만들고, 각 태그 섹션 내부에서 시간순으로 정렬
    Object.entries(memosByTag).forEach(([tagCode, tagGroup]) => {
      if (tagGroup.memosByBook) {
        // 각 태그 섹션 내의 모든 메모를 수집
        const tagMemos = [];
        
        Object.values(tagGroup.memosByBook).forEach((bookGroup) => {
          if (bookGroup.memos && Array.isArray(bookGroup.memos)) {
            bookGroup.memos.forEach(memo => {
              // 책 정보 추가
              memo.bookId = bookGroup.bookId || memo.userBookId;
              memo.bookTitle = bookGroup.bookTitle || memo.bookTitle;
              tagMemos.push(memo);
            });
          }
        });
        
        // 태그 섹션 내부에서 시간순으로 정렬 (오래된 메모부터 상단에)
        tagMemos.sort((a, b) => {
          const timeA = new Date(a.memoStartTime || a.createdAt);
          const timeB = new Date(b.memoStartTime || b.createdAt);
          return timeA - timeB; // 시간 순 정렬
        });
        
        if (tagMemos.length > 0) {
          // 태그 섹션 데이터 저장
          tagSectionsData.push({
            tagCode: tagCode,
            memos: tagMemos,
            startIndex: allMemos.length
          });
          
          // 전체 메모 배열에 추가 (페이지네이션 계산용)
          allMemos.push(...tagMemos);
        }
      }
    });
    
    // 메모 배열 저장
    this.memos = allMemos;
    
    // 전체 페이지 수 계산
    const previousTotalPages = this.totalPages;
    this.totalPages = Math.max(1, Math.ceil(allMemos.length / this.memosPerPage));
    
    // 새 메모가 추가되어 페이지 수가 증가했고, 이전에 마지막 페이지에 있었다면 새 마지막 페이지로 이동
    if (this.totalPages > previousTotalPages && this.currentPage === previousTotalPages) {
      this.currentPage = this.totalPages;
    }
    
    // 현재 페이지가 전체 페이지를 초과하면 마지막 페이지로 조정
    // 또는 메모 저장 후 항상 마지막 페이지로 이동하도록 함 (currentPage === 999인 경우)
    if (this.currentPage > this.totalPages || this.currentPage === 999) {
      this.currentPage = this.totalPages;
    }
    
    if (allMemos.length === 0) {
      // 메모가 없어도 선택된 책이 있고 마지막 페이지라면 빈 섹션 생성
      if (this.currentPage === this.totalPages && this.selectedBookId) {
        this.createEmptyBookSectionWithEditor();
        this.updatePagination();
        return;
      }
      this.showEmptyState();
      this.updatePagination();
      return;
    }
    
    // 현재 페이지의 메모 범위 계산
    const startIndex = (this.currentPage - 1) * this.memosPerPage;
    const endIndex = startIndex + this.memosPerPage;
    
    // 태그 섹션 렌더링 (현재 페이지에 해당하는 메모만 표시)
    tagSectionsData.forEach((sectionData) => {
      const { tagCode, memos, startIndex: sectionStartIndex } = sectionData;
      const sectionEndIndex = sectionStartIndex + memos.length;
      
      // 현재 페이지 범위와 겹치는지 확인
      if (sectionEndIndex > startIndex && sectionStartIndex < endIndex) {
        // 현재 페이지에 해당하는 메모만 필터링
        const visibleMemos = memos.filter((memo, index) => {
          const globalIndex = sectionStartIndex + index;
          return globalIndex >= startIndex && globalIndex < endIndex;
        });
        
        if (visibleMemos.length > 0) {
          // 태그 섹션 렌더링
          this.renderTagSection(tagCode, visibleMemos, sectionStartIndex);
        }
      }
    });
    
    // 페이지네이션 UI 업데이트
    this.updatePagination();
  }
  
  /**
   * 태그 섹션 렌더링
   * @param {string} tagCode - 태그 코드
   * @param {Array} memos - 해당 태그의 메모 배열 (이미 시간순으로 정렬됨)
   * @param {number} startIndex - 전체 메모 배열에서의 시작 인덱스
   */
  renderTagSection(tagCode, memos, startIndex) {
    if (!memos || memos.length === 0) return;
    
    // 태그 라벨 가져오기
    const tagLabel = MemoCard.getTagLabel(tagCode);
    
    // 태그 섹션 HTML 생성
    const sectionHtml = `
      <div class="memo-tag-section" data-tag-code="${this.escapeHtml(tagCode)}" data-start-index="${startIndex}">
        <div class="memo-tag-section-header">
          <h3 class="memo-tag-section-title">${this.escapeHtml(tagLabel)}</h3>
        </div>
        <div class="memo-tag-section-grid">
          ${memos.map(memo => MemoCard.render(memo)).join('')}
        </div>
      </div>
    `;
    
    const sectionElement = document.createRange().createContextualFragment(sectionHtml);
    this.memoList.appendChild(sectionElement.firstElementChild);
  }

  /**
   * 인라인 캘린더 토글
   */
  async toggleInlineCalendar() {
    this.isCalendarVisible = !this.isCalendarVisible;
    
    if (this.inlineCalendarSection) {
      this.inlineCalendarSection.style.display = this.isCalendarVisible ? 'block' : 'none';
    }
    
    if (this.isCalendarVisible) {
      // 캘린더 표시 시 현재 년/월로 초기화
      this.calendarYear = new Date().getFullYear();
      this.calendarMonth = new Date().getMonth() + 1;
      await this.renderInlineCalendar();
    }
  }

  /**
   * 인라인 캘린더 렌더링
   */
  async renderInlineCalendar() {
    if (!this.inlineCalendarContainer) return;

    // 메모 작성 날짜 목록 로드
    await this.loadCalendarMemoDates();

    // 캘린더 HTML 생성
    const calendarHtml = this.generateCalendarHtml();
    this.inlineCalendarContainer.innerHTML = calendarHtml;
  }

  /**
   * 캘린더 메모 작성 날짜 목록 로드
   */
  async loadCalendarMemoDates() {
    try {
      this.calendarMemoDates = await memoService.getMemoDates(this.calendarYear, this.calendarMonth);
    } catch (error) {
      console.error('메모 작성 날짜 목록 로드 오류:', error);
      this.calendarMemoDates = [];
    }
  }

  /**
   * 캘린더 HTML 생성
   * @returns {string} HTML 문자열
   */
  generateCalendarHtml() {
    const firstDay = new Date(this.calendarYear, this.calendarMonth - 1, 1);
    const lastDay = new Date(this.calendarYear, this.calendarMonth, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 (일요일) ~ 6 (토요일)

    const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    let html = `
      <div class="calendar-header">
        <button class="calendar-nav-btn prev">‹</button>
        <div class="calendar-month-year">${this.calendarYear}년 ${monthNames[this.calendarMonth - 1]}</div>
        <button class="calendar-nav-btn next">›</button>
      </div>
      <div class="calendar-grid">
    `;

    // 요일 헤더
    dayNames.forEach(day => {
      html += `<div class="calendar-day-header">${day}</div>`;
    });

    // 빈 칸 (첫 날 이전)
    for (let i = 0; i < startDayOfWeek; i++) {
      html += '<div class="calendar-day other-month"></div>';
    }

    // 날짜 셀
    const today = new Date();
    const currentDateStr = this.currentDate;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${this.calendarYear}-${String(this.calendarMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = today.getFullYear() === this.calendarYear &&
                     today.getMonth() + 1 === this.calendarMonth &&
                     today.getDate() === day;
      const hasMemo = this.calendarMemoDates.includes(dateStr);
      const isSelected = dateStr === currentDateStr;
      
      let classes = 'calendar-day';
      if (isToday) classes += ' today';
      if (hasMemo) classes += ' has-memo';
      if (isSelected) classes += ' selected';
      
      html += `<div class="${classes}" data-date="${dateStr}">${day}</div>`;
    }

    // 빈 칸 (마지막 날 이후)
    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = 7 - (totalCells % 7);
    if (remainingCells < 7) {
      for (let i = 0; i < remainingCells; i++) {
        html += '<div class="calendar-day other-month"></div>';
      }
    }

    html += '</div>';
    return html;
  }

  /**
   * 캘린더 월 이동
   * @param {number} delta - 이동할 월 수 (-1: 이전 달, 1: 다음 달)
   */
  async navigateCalendarMonth(delta) {
    this.calendarMonth += delta;
    if (this.calendarMonth < 1) {
      this.calendarMonth = 12;
      this.calendarYear--;
    } else if (this.calendarMonth > 12) {
      this.calendarMonth = 1;
      this.calendarYear++;
    }
    await this.renderInlineCalendar();
  }

  /**
   * 캘린더 날짜 클릭 처리
   * @param {string} date - 선택된 날짜 (YYYY-MM-DD)
   */
  async handleCalendarDateClick(date) {
    const hasMemo = this.calendarMemoDates.includes(date);
    
    if (hasMemo) {
      // 메모가 있는 날짜: 해당 날짜의 메모 로드
      await this.loadMemoFlow(date);
      // 캘린더 다시 렌더링하여 선택 상태 업데이트
      await this.renderInlineCalendar();
    } else {
      // 메모가 없는 날짜: 안내 메시지
      alert('해당 날짜에 작성된 메모가 없습니다.');
    }
  }

  /**
   * 그룹화 방식 변경
   * @param {string} grouping - 그룹화 방식 (SESSION, BOOK, TAG)
   */
  handleGroupingChange(grouping) {
    this.currentGrouping = grouping;
    // 그룹화 방식 변경 시 첫 페이지로 리셋
    this.currentPage = 1;
    
    // 그룹화 버튼 활성화 상태 업데이트
    if (this.groupingToggle) {
      this.groupingToggle.querySelectorAll('.grouping-btn').forEach((btn) => {
        if (btn.dataset.grouping === grouping) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
    
    // TAG 모드일 때만 태그 대분류 섹션 표시 (SESSION 모드에서는 숨김)
    if (grouping === 'TAG') {
      if (this.tagCategorySection) {
        this.tagCategorySection.style.display = 'block';
      }
    } else {
      if (this.tagCategorySection) {
        this.tagCategorySection.style.display = 'none';
      }
    }
    
    // 메모 다시 로드
    this.loadMemoFlow();
  }

  /**
   * 태그 대분류 변경
   * @param {string} category - 태그 대분류 (TYPE, TOPIC)
   */
  handleTagCategoryChange(category) {
    this.currentTagCategory = category;
    // 태그 대분류 변경 시 첫 페이지로 리셋
    this.currentPage = 1;
    
    // 태그 대분류 Tab 활성화 상태 업데이트
    if (this.tagCategoryToggle) {
      this.tagCategoryToggle.querySelectorAll('.tag-category-tab').forEach((tab) => {
        if (tab.dataset.category === category) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });
    }
    
    // 메모 다시 로드
    this.loadMemoFlow();
  }

  /**
   * 책 선택 모달 표시
   */
  async showBookSelector() {
    if (!this.bookSelector) return;
    
    this.bookSelector.show((book) => {
      this.handleBookSelect(book);
    });
  }

  /**
   * 책 선택 처리
   * @param {Object} book - 선택된 책 정보
   */
  async handleBookSelect(book) {
    this.selectedBook = book;
    this.selectedBookId = book.userBookId;
    
    // 선택된 책 정보 표시
    if (this.selectedBookInfo) {
      this.selectedBookInfo.style.display = 'block';
    }
    if (this.selectedBookTitle) {
      this.selectedBookTitle.textContent = book.title || '제목 없음';
    }
    if (this.selectedBookAuthor) {
      this.selectedBookAuthor.textContent = book.author || '저자 정보 없음';
    }
    
    // 메모 목록 다시 로드하여 입력 컴포넌트를 올바른 위치에 배치
    // 새 책 선택 시 마지막 페이지로 이동하여 메모 작성 UI 표시
    this.currentPage = 999; // 마지막 페이지로 이동하도록 표시
    await this.loadMemoFlow();
    
    // 메모 로드 후 선택된 책에 대한 메모 에디터 표시 보장
    // (다른 책의 메모만 있을 경우 선택된 책 섹션이 없을 수 있음)
    this.restoreMemoEditor();
    
    // WebSocket은 이미 연결되어 있음 (FlowView 진입 시 연결)
    console.log('[FlowView] 책 선택 완료, userBookId:', book.userBookId);
    
    // 책 선택 시 자동으로 빈 메모 생성 (WebSocket 기반 - 저장 버튼 없음)
    // pendingCreateMemoData가 있으면 해당 데이터로 생성, 없으면 빈 메모 생성
    try {
      const createData = this.pendingCreateMemoData 
        ? Object.assign({}, this.pendingCreateMemoData, { userBookId: this.selectedBookId })
        : {
            userBookId: this.selectedBookId,
            pageNumber: 1, // 기본 페이지 번호
            content: '', // 빈 내용으로 시작
            tags: [],
            tagCategory: 'TYPE',
            memoStartTime: new Date().toISOString(),
          };
      
      // assign a numeric clientTempId and an eventId to correlate server response
      const clientTempId = this.generateTempNumericId();
      const eventId = this.generateUUID();
      // send clientTempId as numeric long-like value (no decimal)
      createData.clientTempId = clientTempId;
      // include eventId to allow server to echo it back for reliable correlation
      createData.eventId = eventId;
      
      // create a temp memo locally
      const tempMemo = {
        id: clientTempId,
        cacheMemoId: clientTempId,
        userBookId: this.selectedBookId,
        pageNumber: createData.pageNumber,
        content: createData.content,
        tags: createData.tags || [],
        memoStartTime: createData.memoStartTime || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        bookTitle: this.selectedBook?.title || ''
      };
      // mark as optimistic local-only memo so it won't render as a card
      tempMemo.__isTemp = true;
      this.memos.push(tempMemo);
      
      // mark that we are waiting for the server's create response
      this.pendingCreateMemoData = Object.assign({}, createData, { eventId });
      this.waitingForCreate = true;

      await webSocketService.createMemo(createData);
      // do NOT clear pending here; wait for memo:create event to match and clear
    } catch (err) {
      console.error('[FlowView] 책 선택 후 메모 생성 실패:', err);
      alert('선택한 책으로 메모를 생성하는 동안 오류가 발생했습니다: ' + (err.message || err));
      // reset pending flags on error
      this.pendingCreateMemoData = null;
      this.waitingForCreate = false;
    }
  }

  // ==================== WebSocket 실시간 동기화 ====================

  /**
   * WebSocket 이벤트 리스너 설정
   */
  setupWebSocketListeners() {
    // ===== 메모 WebSocket 이벤트 =====
    // 메모 생성 응답 - 로컬에 추가하고, pending create가 있으면 즉시 편집 모드로 전환
    webSocketService.on('memo:create', (response) => {
      console.log('[FlowView] WebSocket memo:create 응답:', response);

      // If the server echoed an eventId that matches our pending create, mark as self-originated
      const responseEventId = response?.eventId || response?.data?.eventId;
      const isSelfCreate = !!(responseEventId && this.pendingCreateMemoData && this.pendingCreateMemoData.eventId === responseEventId);

      const memoDtos = response?.memoDtos || response?.data?.memoDtos || [];
      if (!Array.isArray(memoDtos) || memoDtos.length === 0) {
        console.warn('[FlowView] memo:create: 페이로드가 예상과 다릅니다.', response);
        return;
      }

      // Map DTOs to memo objects and append to local this.memos if missing
      const createdIds = [];
      const clientTempToServer = {}; // map clientTempId -> server id
      const signatureToServer = {}; // map userBookId|page|content -> server id
      memoDtos.forEach((dto) => {
        const id = dto.cacheMemoId ?? dto.memoId ?? dto.id;
        const clientTempId = dto.clientTempId ?? dto.clientTempUuid ?? dto.clientTemp ?? dto.cacheMemoId;
        const userBookId = dto.cacheUserShelfBookId ?? dto.userBookId ?? dto.userBookIdRaw;
        const tags = dto.cacheTagIds ?? dto.tags ?? [];
        // build signature and mapping for fallback matching
        try {
          const sig = `${String(userBookId)}|${String(dto.pageNumber)}|${String(dto.content || '')}`;
          if (id !== undefined && id !== null) signatureToServer[sig] = id;
        } catch (e) {
          // ignore
        }
        // map clientTempId to server id when available
        if (clientTempId !== undefined && clientTempId !== null) {
          clientTempToServer[String(clientTempId)] = id;
        }
        const memoObj = {
          id,
          userBookId,
          pageNumber: dto.pageNumber,
          content: dto.content,
          tags,
          memoStartTime: dto.memoStartTime,
          createdAt: dto.createdAt,
          updatedAt: dto.updatedAt,
          bookTitle: dto.bookTitle || dto.bookName || ''
        };

        // If this response corresponds to a create we initiated, prefer to merge with our optimistic temp
        if (isSelfCreate) {
          // Try matching by echoed clientTempId first
          let tempIndex = -1;
          if (clientTempId) {
            tempIndex = this.memos.findIndex(m => String(m.id) === String(clientTempId) || String(m.cacheMemoId) === String(clientTempId) || String(m.clientTempId) === String(clientTempId));
          }

          // Fallback: match any optimistic temp memo for the same userBookId + pageNumber + empty content
          if (tempIndex === -1) {
            tempIndex = this.memos.findIndex(m => m.__isTemp && String(m.userBookId) === String(userBookId) && String(m.pageNumber) === String(dto.pageNumber));
          }

          if (tempIndex !== -1) {
            const existingTemp = this.memos[tempIndex];
            memoObj.id = id;
            memoObj.createdAt = dto.createdAt || existingTemp.createdAt || memoObj.createdAt;
            // remove temp flag
            memoObj.__isTemp = false;
            this.memos[tempIndex] = Object.assign({}, existingTemp, memoObj);
          } else {
            // If no temp found, behave as usual and avoid duplicates
            const exists = this.memos.find(m => String(m.id) === String(id) || String(m.memoId) === String(id) || String(m.cacheMemoId) === String(id));
            if (!exists) this.memos.push(memoObj);
          }
        } else {
          // add if not exists (response from other clients)
          const exists = this.memos.find(m => String(m.id) === String(id) || String(m.memoId) === String(id) || String(m.cacheMemoId) === String(id));
          if (!exists) this.memos.push(memoObj);
        }
        createdIds.push(String(id));
      });

      // Re-render memos from local cache (avoid REST call)
      const memosByBook = {};
      this.memos.forEach((m) => {
        const bookId = m.userBookId ?? m.bookId ?? 'unknown';
        if (!memosByBook[bookId]) {
          memosByBook[bookId] = { bookId: bookId, bookTitle: m.bookTitle ?? '', memos: [] };
        }
        memosByBook[bookId].memos.push(m);
      });

      const renderResponse = {
        memosByBook: Object.fromEntries(Object.entries(memosByBook).map(([k, v]) => [k, { bookId: v.bookId, bookTitle: v.bookTitle, memos: v.memos }])),
        memosByTag: {},
        totalMemoCount: this.memos.length,
      };

      // Ensure we show last page where new memo likely lives
      this.currentPage = 999;
      this.renderMemos(renderResponse);

      // If we are waiting for a pending create, try to match and enter edit mode
      if (this.waitingForCreate && this.pendingCreateMemoData) {
        // Try to find the created memo by matching userBookId + pageNumber + content + memoStartTime
        // Prefer matching by clientTempId (server echoed). If not present, fallback to content+page match.
        const clientTemp = this.pendingCreateMemoData.clientTempId;
        let match = null;
        if (clientTemp) {
          match = this.memos.find(m => String(m.id) === String(clientTemp) || String(m.cacheMemoId) === String(clientTemp));
        }
        if (!match) {
          match = this.memos.find(m => {
            const idStr = String(m.id ?? m.memoId ?? m.cacheMemoId ?? '');
            if (!idStr) return false;
            const matchUserBook = String(m.userBookId) === String(this.selectedBookId);
            const matchPage = (m.pageNumber == this.pendingCreateMemoData.pageNumber);
            const matchContent = String(m.content || '') === String(this.pendingCreateMemoData.content || '');
            return matchUserBook && matchPage && matchContent;
          });
        }

        if (match) {
          // determine server-assigned id for this created memo
          let serverId = null;
          if (clientTemp && clientTempToServer && clientTempToServer[String(clientTemp)] !== undefined) {
            serverId = clientTempToServer[String(clientTemp)];
          }
          if (!serverId) {
            const sig = `${String(this.selectedBookId)}|${String(this.pendingCreateMemoData.pageNumber)}|${String(this.pendingCreateMemoData.content || '')}`;
            if (signatureToServer && signatureToServer[sig] !== undefined) serverId = signatureToServer[sig];
          }

          // If we found a serverId, update the matched memo object's id fields to the serverId
          if (serverId !== null && serverId !== undefined) {
            console.log('[FlowView] 생성된 메모 서버 ID 매칭됨:', serverId, '기존 임시 ID:', match.id ?? match.cacheMemoId);
            // update in-place
            match.id = serverId;
            match.cacheMemoId = serverId;
            // ensure internal this.memos reflects change
            const idx = this.memos.findIndex(m => (String(m.id) === String(serverId) || String(m.cacheMemoId) === String(serverId)));
            if (idx !== -1) this.memos[idx] = match;
            this.editingMemoId = serverId;
          } else {
            const newId = match.id ?? match.memoId ?? match.cacheMemoId;
            console.log('[FlowView] 생성된 메모을 찾음(서버ID 없음), 편집 모드 진입, memoId:', newId);
            this.editingMemoId = newId;
          }
          // ensure selectedBookId is set
          this.selectedBookId = match.userBookId;
          // place editor into the section and set data
          this.restoreMemoEditor();
          const idToEdit = this.editingMemoId;
          this.handleMemoEdit(idToEdit);

          // clear pending flags
          this.pendingCreateMemoData = null;
          this.waitingForCreate = false;
        } else {
          console.log('[FlowView] 생성된 메모를 아직 찾지 못했습니다. 대기 상태 유지.');
        }
      }
    });

    // 메모 업데이트 응답 - 부분 갱신 처리 (REST 재요청 방지)
    webSocketService.on('memo:update', (response) => {
      console.log('[FlowView] WebSocket memo:update 응답:', response);

      // 예상되는 형태: { memoDtos: [ { cacheMemoId, cacheUserShelfBookId, pageNumber, content, cacheTagIds, memoStartTime, createdAt, updatedAt } ] }
      const memoDtos = response?.memoDtos || response?.data?.memoDtos || [];

      if (!Array.isArray(memoDtos) || memoDtos.length === 0) {
        // 페이로드가 예상과 다르면 안전하게 전체 재로딩 (예외적 상황)
        console.warn('[FlowView] memo:update: 예기치 않은 페이로드, 전체 재로드 수행');
        this.loadMemoFlow();
        return;
      }

      // Helper: map incoming DTO -> UI memo object
      const mapDtoToMemo = (dto) => {
        const id = dto.cacheMemoId ?? dto.memoId ?? dto.id;
        const userBookId = dto.cacheUserShelfBookId ?? dto.userBookId ?? dto.userBookIdRaw;
        const tags = dto.cacheTagIds ?? dto.tags ?? [];
        return {
          id,
          userBookId,
          pageNumber: dto.pageNumber,
          content: dto.content,
          tags,
          memoStartTime: dto.memoStartTime,
          createdAt: dto.createdAt,
          updatedAt: dto.updatedAt,
        };
      };

      // Flag: whether any update targets the memo currently being edited
      let touchedEditingMemo = false;

      // Apply updates to this.memos (in-place) or insert if missing
      memoDtos.forEach((dto) => {
        const updated = mapDtoToMemo(dto);

        // If this update is for the memo currently being edited, apply it directly to the editor
        if (this.editingMemoId && String(this.editingMemoId) === String(updated.id)) {
          touchedEditingMemo = true;

          // Update editor fields in-place without re-rendering the whole list
          if (this.memoEditor && typeof this.memoEditor.setMemoData === 'function') {
            const memoData = {
              pageNumber: updated.pageNumber,
              content: updated.content,
              tags: Array.isArray(updated.tags) ? updated.tags.map(t => (typeof t === 'string' ? t : t.code)) : [],
            };
            try {
              this.memoEditor.setMemoData(memoData);
              console.log('[FlowView] Editing memo updated in-place via WebSocket, memoId:', updated.id);
            } catch (err) {
              console.warn('[FlowView] Failed to apply update to editor:', err);
            }
          }
        }

        // Attempt to find existing memo by several id keys
        const existing = this.memos.find(m => {
          return String(m.id) === String(updated.id) || String(m.memoId) === String(updated.id) || String(m.cacheMemoId) === String(updated.id);
        });

        if (existing) {
          // Merge fields
          Object.assign(existing, updated);
        } else {
          // Try to enrich bookTitle from cached userShelfBooks if possible
          const book = (this.userShelfBooks || []).find(b => String(b.cacheUserShelfBookId ?? b.userBookId) === String(updated.userBookId));
          if (book) {
            updated.bookTitle = book.title ?? book.bookTitle;
          }
          this.memos.push(updated);
        }
      });

      // If the currently editing memo was touched, avoid a full re-render to keep the editor in-place
      if (touchedEditingMemo) {
        // We already updated the editor and internal this.memos entries; nothing more to do.
        return;
      }

      // Otherwise rebuild memosByBook structure for renderMemos and re-render
      const memosByBook = {};
      this.memos.forEach((m) => {
        const bookId = m.userBookId ?? m.bookId ?? 'unknown';
        if (!memosByBook[bookId]) {
          memosByBook[bookId] = {
            book: { userBookId: bookId, title: m.bookTitle ?? '' },
            memos: []
          };
        }
        memosByBook[bookId].memos.push(m);
      });

      const renderResponse = {
        memosByBook: Object.fromEntries(Object.entries(memosByBook).map(([k, v]) => [k, { bookId: v.book.userBookId, bookTitle: v.book.title, memos: v.memos } ])),
        memosByTag: {},
        totalMemoCount: this.memos.length
      };

      // 재렌더링 (부분 갱신 대신 안전하게 전체 렌더)
      this.renderMemos(renderResponse);
    });

    // 메모 삭제 응답 - REST로 전체 재로딩하지 않고 로컬에서 제거 후 재렌더
    webSocketService.on('memo:delete', (response) => {
      console.log('[FlowView] WebSocket memo:delete 응답:', response);

      // Extract deleted memo ids from various possible payload shapes
      const deletedIds = [];
      const pushId = (v) => { if (v !== undefined && v !== null) deletedIds.push(String(v)); };

      try {
        if (Array.isArray(response?.memoDtos)) {
          response.memoDtos.forEach(dto => pushId(dto.cacheMemoId ?? dto.memoId ?? dto.id));
        } else if (response?.memoId) {
          pushId(response.memoId);
        } else if (response?.data) {
          const d = response.data;
          if (Array.isArray(d?.memoDtos)) d.memoDtos.forEach(dto => pushId(dto.cacheMemoId ?? dto.memoId ?? dto.id));
          else if (d?.memoId) pushId(d.memoId);
        }
      } catch (e) {
        console.warn('[FlowView] memo:delete - 페이로드 파싱 실패, 응답:', response, e);
      }

      if (deletedIds.length === 0) {
        // If we couldn't determine deleted ids, avoid triggering REST reload per request.
        console.warn('[FlowView] memo:delete - 삭제된 메모 ID를 파악할 수 없습니다. REST 재로드를 생략합니다.');
        return;
      }

      // Remove deleted memos from local cache
      const beforeCount = this.memos.length;
      this.memos = this.memos.filter(m => {
        const idVals = [m.id, m.memoId, m.cacheMemoId].map(v => v === undefined || v === null ? '' : String(v));
        return !deletedIds.some(del => idVals.includes(del));
      });
      const afterCount = this.memos.length;
      console.log('[FlowView] 로컬 메모 목록에서 삭제 반영:', beforeCount, '->', afterCount);

      // Rebuild memosByBook structure and re-render (avoid REST)
      const memosByBook = {};
      this.memos.forEach((m) => {
        const bookId = m.userBookId ?? m.bookId ?? 'unknown';
        if (!memosByBook[bookId]) {
          memosByBook[bookId] = { bookId: bookId, bookTitle: m.bookTitle ?? '', memos: [] };
        }
        memosByBook[bookId].memos.push(m);
      });

      const renderResponse = {
        memosByBook: Object.fromEntries(Object.entries(memosByBook).map(([k, v]) => [k, { bookId: v.bookId, bookTitle: v.bookTitle, memos: v.memos }])),
        memosByTag: {},
        totalMemoCount: this.memos.length,
      };

      this.renderMemos(renderResponse);
    });

    // ===== 도서(UserShelfBook) WebSocket 이벤트 =====
    // 도서 생성 응답
    webSocketService.on('book:create', (response) => {
      console.log('[FlowView] WebSocket book:create 응답:', response);
    });

    // 도서 업데이트 응답 (책 덮기 등)
    webSocketService.on('book:update', (response) => {
      console.log('[FlowView] WebSocket book:update 응답:', response);
    });

    // 도서 삭제 응답
    webSocketService.on('book:delete', (response) => {
      console.log('[FlowView] WebSocket book:delete 응답:', response);
    });

    // 연결 상태 변경
    webSocketService.on('connectionStateChange', ({ state }) => {
      console.log('[FlowView] WebSocket 연결 상태:', state);
      this.wsConnected = (state === 'CONNECTED');
    });

    // 에러 처리
    webSocketService.on('error', (error) => {
      console.error('[FlowView] WebSocket 에러:', error);
    });
  }

  /**
   * WebSocket 연결 (FlowView 진입 시 호출)
   * 연결 완료 후 loadMemoFlow에서 WebSocket으로 데이터 로드
   */
  async connectWebSocket() {
    try {
      // 사용자 ID를 roomId로 사용 (authHelper에서 가져오기)
      const user = authHelper.getCurrentUser();
      const roomId = user?.id || user?.userId || 1;

      // 통합 WebSocket 연결 (Book + Memo 모두 하나의 연결로 처리)
      await webSocketService.connect(roomId);
      this.wsConnected = true;
      console.log('[FlowView] WebSocket 연결 완료, roomId:', roomId);

      // WebSocket 연결 후 메모 다시 로드 (WebSocket 기반)
      await this.loadMemoFlow();

    } catch (error) {
      console.error('[FlowView] WebSocket 연결 실패:', error);
      this.wsConnected = false;
      // 연결 실패해도 loadMemoFlow에서 REST 폴백 처리
    }
  }

  /**
   * 메모 입력 변경 처리 (debounce 적용)
   * @param {Object} memoData - 메모 에디터에서 전달된 메모 데이터
   */
  handleMemoInput(memoData) {
    // WebSocket 연결 안 되어 있으면 스킵
    if (!this.wsConnected) {
      return;
    }

    // debounce 적용
    if (this.wsUpdateDebounceTimer) {
      clearTimeout(this.wsUpdateDebounceTimer);
    }

    this.wsUpdateDebounceTimer = setTimeout(() => {
      this.sendMemoUpdate(memoData);
    }, this.wsUpdateDebounceDelay);
  }

  /**
   * WebSocket으로 메모 업데이트 전송 (수정 모드에서만 사용)
   * @param {Object} memoData - 메모 데이터
   */
  async sendMemoUpdate(memoData) {
    // 수정 모드가 아니거나 WebSocket 연결 안 되어 있으면 스킵
    if (!this.wsConnected || !this.editingMemoId) {
      return;
    }

    try {
      await webSocketService.updateMemo(this.editingMemoId, {
        content: memoData.content || '',
        tags: memoData.tags || [],
        tagCategory: memoData.tagCategory || 'TYPE',
      });
      console.log('[FlowView] WebSocket 메모 업데이트 전송, memoId:', this.editingMemoId);
    } catch (error) {
      console.error('[FlowView] WebSocket 메모 업데이트 실패:', error);
    }
  }

  /**
   * debounce 타이머 정리 (저장 완료 시)
   */
  clearWebSocketDebounce() {
    if (this.wsUpdateDebounceTimer) {
      clearTimeout(this.wsUpdateDebounceTimer);
      this.wsUpdateDebounceTimer = null;
    }
    console.log('[FlowView] WebSocket debounce 타이머 정리');
  }

  /**
   * debounce 타이머 정리 (취소 시)
   */
  cancelWebSocketDebounce() {
    if (this.wsUpdateDebounceTimer) {
      clearTimeout(this.wsUpdateDebounceTimer);
      this.wsUpdateDebounceTimer = null;
    }
    console.log('[FlowView] WebSocket debounce 타이머 정리 (취소)');
  }

  // ==================== 메모 저장/수정/취소 ====================


  /**
   * 메모 작성 취소 처리
   */
  async handleMemoCancel(memoData) {
    console.log('[FlowView] 메모 작성 취소 처리 시작, isProcessingMemoClose:', this.isProcessingMemoClose);
    // 중복 실행 방지
    if (this.isProcessingMemoClose) return;
    this.isProcessingMemoClose = true;

    // 닫기 버튼 동작: 사용자가 작성한 내용이 있으면 저장 동작을 수행하고,
    // 내용이 없으면 단순히 에디터를 닫는다.
    try {
      if (!this.memoEditor) {
        return;
      }

      // prefer memoData passed from MemoEditor (snapshot before clear)
      const content = (memoData && typeof memoData.content !== 'undefined')
        ? String(memoData.content).trim()
        : (this.memoEditor.memoInput ? this.memoEditor.memoInput.value.trim() : '');

      try {
        const globalInput = document.getElementById('memo-input');
        console.log('[FlowView] handleMemoCancel - content length:', content.length, 'editingMemoId:', this.editingMemoId, 'memoInput === global:', this.memoEditor.memoInput === globalInput, 'document.activeElement:', document.activeElement && (document.activeElement.id || document.activeElement.tagName));
      } catch (e) {
        console.error('[FlowView] diagnostic failed:', e);
      }

      const pageNumber = (memoData && typeof memoData.pageNumber !== 'undefined') ? memoData.pageNumber : (this.memoEditor.memoPageInput ? parseInt(this.memoEditor.memoPageInput.value, 10) : null);
      const tags = this.memoEditor.selectedTags ? Array.from(this.memoEditor.selectedTags) : [];
      const tagCategory = this.memoEditor.getTagCategoryFromSelectedTags ? this.memoEditor.getTagCategoryFromSelectedTags() : 'TYPE';

      // No content -> just close
      if (!content) {
        // perform hide flow below
      } else {
        // If editing existing memo -> update, else -> create
        if (this.editingMemoId) {
          // Send update
          await webSocketService.updateMemo(this.editingMemoId, {
            content: content,
            tags: tags || [],
            tagCategory: tagCategory || 'TYPE'
          });

          // clear debounce
          this.clearWebSocketDebounce();

          // Optimistically update local model so UI shows edited text immediately
          const updatedObj = {
            id: this.editingMemoId,
            content: content,
            pageNumber: pageNumber,
            tags: tags || [],
            updatedAt: (new Date()).toISOString()
          };
          console.log('[FlowView] 닫기 - 업데이트할 내용:', updatedObj);
          
          // this.memos도 업데이트 (다음 렌더링을 위해)
          const existing = this.memos.find(m => String(m.id) === String(this.editingMemoId) || String(m.memoId) === String(this.editingMemoId) || String(m.cacheMemoId) === String(this.editingMemoId));
          if (existing) {
            Object.assign(existing, updatedObj);
          }

          // 저장할 editingMemoId를 미리 캡처
          const savedMemoId = this.editingMemoId;

          // exit edit mode (moved to finally)
          // this.editingMemoId = null;
          if (this.memoEditor && this.memoEditor.memoPageInput) {
            this.memoEditor.memoPageInput.disabled = false;
            this.memoEditor.memoPageInput.title = '';
          }
          if (this.memoEditor && this.memoEditor.btnCloseMemo) {
            this.memoEditor.btnCloseMemo.textContent = '닫기';
          }

          // clear editor fields
          this.memoEditor.clear();
          
          // 에디터를 먼저 숨기고 나서 DOM 업데이트
          if (this.memoEditor && this.memoEditor.container) {
            const editorParent = this.memoEditor.container.parentNode;
            if (editorParent && (editorParent === this.memoList || this.memoList.contains(editorParent))) {
              if (this.flowContent) {
                this.flowContent.appendChild(this.memoEditor.container);
              }
              this.memoEditor.container.style.display = 'none';
            } else {
              this.memoEditor.container.style.display = 'none';
            }
          }
          if (this.memoInputContainer) {
            this.memoInputContainer.style.display = 'none';
          }

          // 에디터 숨긴 후 DOM에서 해당 메모 카드를 직접 업데이트
          const memoCard = this.memoList.querySelector(`.memo-card[data-memo-id="${savedMemoId}"]`);
          console.log('[FlowView] 닫기 - 메모 카드 찾기:', savedMemoId, memoCard ? '찾음' : '못찾음');
          if (memoCard) {
            const contentEl = memoCard.querySelector('.memo-card-content');
            if (contentEl) {
              contentEl.textContent = content;
              console.log('[FlowView] 닫기 - DOM 직접 업데이트 완료:', content.substring(0, 30));
            }
            
            // 태그도 업데이트
            const tagsContainer = memoCard.querySelector('.memo-card-tags');
            if (tagsContainer && tags && tags.length > 0) {
              const tagsHtml = tags.map(tag => {
                const tagLabel = typeof tag === 'string' ? tag : (tag.code || tag);
                return `<span class="memo-tag">${this.escapeHtml(tagLabel)}</span>`;
              }).join('');
              tagsContainer.innerHTML = tagsHtml;
            }
          } else {
            // 메모 카드를 찾지 못하면 MemoCard.render()로 새로 만들어서 교체
            console.log('[FlowView] 닫기 - 메모 카드를 찾지 못함, 새로 렌더링');
            
            // existing 메모 객체 가져오기
            const memoToRender = this.memos.find(m => String(m.id) === String(savedMemoId) || String(m.memoId) === String(savedMemoId) || String(m.cacheMemoId) === String(savedMemoId));
            if (memoToRender) {
              // 새 메모 카드 HTML 생성
              const newCardHtml = MemoCard.render(memoToRender);
              
              // 해당 책 섹션의 그리드를 찾아서 기존 카드 위치에 삽입하거나 추가
              const bookId = memoToRender.userBookId ?? memoToRender.bookId ?? 'unknown';
              const bookSection = this.memoList.querySelector(`.memo-book-section[data-book-id="${bookId}"]`);
              if (bookSection) {
                const memoGrid = bookSection.querySelector('.memo-section-grid');
                if (memoGrid) {
                  // 기존 카드가 있으면 교체, 없으면 마지막에 추가
                  const existingCard = memoGrid.querySelector(`.memo-card[data-memo-id="${savedMemoId}"]`);
                  if (existingCard) {
                    existingCard.outerHTML = newCardHtml;
                    console.log('[FlowView] 닫기 - 기존 카드 교체 완료');
                  } else {
                    memoGrid.insertAdjacentHTML('beforeend', newCardHtml);
                    console.log('[FlowView] 닫기 - 새 카드 추가 완료');
                  }
                }
              }
            }
          }

          // WebSocket memo:update 응답이 오면 자동으로 동기화됨
          // 백그라운드 loadMemoFlow() 호출 제거 - 이전 데이터로 덮어쓰는 문제 방지
          
          // finally 블록에서 에디터를 다시 숨기지 않도록 플래그 설정
          return; // finally 블록 스킵하기 위해 여기서 return
        } else {
          // creating new memo: validate page number
          const today = new Date().toISOString().split('T')[0];
          if (this.currentDate !== today) {
            alert('메모는 오늘 날짜에만 작성할 수 있습니다. 닫기 전에 날짜를 오늘로 변경하세요.');
            return;
          }
          if (!pageNumber || isNaN(pageNumber) || pageNumber < 1) {
            alert('페이지 번호를 입력해주세요. (1 이상의 숫자)');
            return;
          }

          const createData = {
            userBookId: this.selectedBookId,
            pageNumber: pageNumber,
            content: content,
            tags: tags || [],
            tagCategory: tagCategory || 'TYPE',
            memoStartTime: (() => {
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              const hours = String(now.getHours()).padStart(2, '0');
              const minutes = String(now.getMinutes()).padStart(2, '0');
              const seconds = String(now.getSeconds()).padStart(2, '0');
              return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
            })(),
          };

          await webSocketService.createMemo(createData);
          this.clearWebSocketDebounce();

          // reset editor and go to last page
          this.memoEditor.clear();
          this.currentPage = 999;
          await this.loadMemoFlow();
        }
      }
    } catch (err) {
      console.error('닫기(저장) 중 오류:', err);
      alert('메모를 저장하는 동안 오류가 발생했습니다: ' + (err.message || err));
    } finally {
      // exit edit mode
      const prevEditingId = this.editingMemoId;
      this.editingMemoId = null;
      
      // Always hide editor UI after attempting save/close
      if (this.memoEditor && this.memoEditor.container) {
        // suppress the next insertion to avoid immediately recreating the editor slot
        this.suppressNextEditorInsert = true;
        const parent = this.memoEditor.container.parentNode;
        if (parent && (parent === this.memoList || this.memoList.contains(parent))) {
          if (this.flowContent && this.memoEditor.container.parentNode !== this.flowContent) {
            this.flowContent.appendChild(this.memoEditor.container);
          }
          this.memoEditor.container.style.display = 'none';
        } else {
          this.memoEditor.container.style.display = 'none';
        }
      }
      if (this.memoInputContainer) {
        this.memoInputContainer.style.display = 'none';
      }

      // Restore original memo card visibility if we had hidden it on edit
      try {
        if (prevEditingId) {
          const originalCard = this.memoList.querySelector(`.memo-card[data-memo-id="${prevEditingId}"]`);
          if (originalCard && originalCard.getAttribute('data-editing-hidden') === 'true') {
            originalCard.style.display = '';
            originalCard.removeAttribute('data-editing-hidden');
          }
        }
      } catch (e) {
        console.warn('[FlowView] failed to restore original memo card visibility:', e);
      }

      this.isProcessingMemoClose = false;
    }
  }

  /**
   * 메모 저장 처리 (memo-editor의 onSave 콜백으로 사용)
   * - 편집 중이면 WebSocket으로 update 전송
   * - 새 메모이고 책이 선택되어 있으면 바로 WebSocket으로 create 전송
   * - 새 메모이고 책이 선택되어 있지 않으면 책 선택 모달을 열고 선택 시 생성
   * @param {Object} memoData
   */
  async handleMemoSave(memoData) {
    try {
      const content = memoData.content ? String(memoData.content).trim() : '';
      const pageNumber = memoData.pageNumber || (this.memoEditor && parseInt(this.memoEditor.memoPageInput?.value, 10)) || null;
      const tags = memoData.tags || [];
      const tagCategory = memoData.tagCategory || 'TYPE';

      if (!content) {
        alert('메모 내용을 입력해주세요.');
        return;
      }

      // 수정 모드
      if (this.editingMemoId) {
        // send update via WebSocket
        await webSocketService.updateMemo(this.editingMemoId, {
          content,
          tags,
          tagCategory,
        });

        // Optimistically update local memo
        const existing = this.memos.find(m => String(m.id) === String(this.editingMemoId) || String(m.memoId) === String(this.editingMemoId) || String(m.cacheMemoId) === String(this.editingMemoId));
        if (existing) {
          Object.assign(existing, { content, tags, updatedAt: (new Date()).toISOString() });
        }

        // clear edit mode and UI
        this.editingMemoId = null;
        if (this.memoEditor) this.memoEditor.clear();
        if (this.memoEditor && this.memoEditor.container) {
          if (this.flowContent && this.memoEditor.container.parentNode !== this.flowContent) {
            this.flowContent.appendChild(this.memoEditor.container);
          }
          this.memoEditor.container.style.display = 'none';
        }
        if (this.memoInputContainer) this.memoInputContainer.style.display = 'none';

        // WebSocket response handler will refresh or partially update UI
        return;
      }

      // 새 메모 작성
      // validate page number (only allow positive integers)
      if (!pageNumber || isNaN(pageNumber) || pageNumber < 1) {
        alert('페이지 번호를 입력해주세요. (1 이상의 숫자)');
        return;
      }

      const createData = {
        userBookId: this.selectedBookId,
        pageNumber: pageNumber,
        content: content,
        tags: tags || [],
        tagCategory: tagCategory || 'TYPE',
        memoStartTime: new Date().toISOString(),
      };

      // If book already selected -> create immediately with optimistic clientTempId
      if (this.selectedBookId) {
        const clientTempId = this.generateTempNumericId();
        // send clientTempId as numeric long-like value (no decimal)
        createData.clientTempId = clientTempId;
        const tempMemo = {
          id: clientTempId,
          cacheMemoId: clientTempId,
          userBookId: this.selectedBookId,
          pageNumber: createData.pageNumber,
          content: createData.content,
          tags: createData.tags || [],
          memoStartTime: createData.memoStartTime,
          createdAt: new Date().toISOString(),
          bookTitle: this.selectedBook?.title || ''
        };
        this.memos.push(tempMemo);
        this.pendingCreateMemoData = createData;
        this.waitingForCreate = true;
        try {
          await webSocketService.createMemo(createData);
        } catch (err) {
          console.error('[FlowView] 메모 생성 실패:', err);
          // cleanup on error
          this.memos = this.memos.filter(m => String(m.id) !== String(clientTempId));
          this.pendingCreateMemoData = null;
          this.waitingForCreate = false;
          alert('메모 생성 중 오류가 발생했습니다: ' + (err.message || err));
        }
        return;
      }

      // No book selected -> remember pending data and open book selector
      this.pendingCreateMemoData = createData;
      this.showBookSelector();

    } catch (error) {
      console.error('[FlowView] 메모 저장 실패:', error);
      alert('메모 저장 중 오류가 발생했습니다: ' + (error.message || error));
    }
  }
  
  /**
   * 메모 수정
   * @param {number} memoId - 메모 ID
   */
  handleMemoEdit(memoId) {
    // 현재 메모 목록에서 메모 찾기
    const memo = this.memos.find(m => m.id === memoId);
    if (!memo) {
      alert('메모를 찾을 수 없습니다.');
      return;
    }
    
    // 수정 모드로 전환
    this.editingMemoId = memoId;
    
    // 선택된 책 정보 설정 (메모가 속한 책)
    if (memo.userBookId) {
      this.selectedBookId = memo.userBookId;
      // 책 정보가 있으면 설정
      if (memo.bookTitle) {
        this.selectedBook = {
          userBookId: memo.userBookId,
          title: memo.bookTitle,
        };
      }
    }
    
    // 메모 에디터에 메모 데이터 설정
    if (this.memoEditor) {
      // 메모 데이터 준비 (태그는 코드 배열로 변환)
      const memoData = {
        pageNumber: memo.pageNumber,
        content: memo.content,
        tags: memo.tags ? memo.tags.map(tag => typeof tag === 'string' ? tag : tag.code) : [],
      };
      
      this.memoEditor.setMemoData(memoData);
      
      // Place the memo editor directly under the memo card being edited
      try {
        const memoCard = this.memoList.querySelector(`.memo-card[data-memo-id="${memoId}"]`);
        if (memoCard && this.memoEditor && this.memoEditor.container) {
          // Insert editor container immediately after the memo card
          const parent = memoCard.parentNode;
          parent.insertBefore(this.memoEditor.container, memoCard.nextSibling);
          this.memoEditor.container.style.display = 'block';
        } else if (this.memoEditor && this.memoEditor.container) {
          // Fallback: just show the editor where it currently is
          this.memoEditor.container.style.display = 'block';
        }
        if (this.memoInputContainer) {
          this.memoInputContainer.style.display = 'block';
        }
      } catch (e) {
        console.warn('[FlowView] failed to position memo editor under card:', e);
        if (this.memoEditor && this.memoEditor.container) {
          this.memoEditor.container.style.display = 'block';
        }
        if (this.memoInputContainer) {
          this.memoInputContainer.style.display = 'block';
        }
      }
      
      // 페이지 번호 입력 필드 비활성화 (수정 불가)
      if (this.memoEditor.memoPageInput) {
        this.memoEditor.memoPageInput.disabled = true;
        this.memoEditor.memoPageInput.title = '페이지 번호는 수정할 수 없습니다.';
      }
      
      // 닫기 버튼 텍스트 변경 (편집 중에는 동일하게 닫기)
      if (this.memoEditor.btnCloseMemo) {
        this.memoEditor.btnCloseMemo.textContent = '닫기';
      }

      // Hide the original memo card while editing so it doesn't appear duplicated
      try {
        const memoCard = this.memoList.querySelector(`.memo-card[data-memo-id="${memoId}"]`);
        if (memoCard) {
          memoCard.style.display = 'none';
          // mark it so we can restore later
          memoCard.setAttribute('data-editing-hidden', 'true');
        }
      } catch (e) {
        console.warn('[FlowView] failed to hide original memo card for edit:', e);
      }
      
      // 메모 에디터로 스크롤
      setTimeout(() => {
        if (this.memoEditor && this.memoEditor.container) {
          this.memoEditor.container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
      
      // WebSocket은 이미 연결되어 있음 (FlowView 진입 시 연결)
      console.log('[FlowView] 메모 수정 모드 진입, memoId:', memoId);
    }
  }

  /**
   * 메모 삭제
   * @param {number} memoId - 메모 ID
   */
  async handleMemoDelete(memoId) {
    if (!confirm('메모를 삭제하시겠습니까?')) {
      return;
    }
    
    try {
      // WebSocket으로 메모 삭제
      await webSocketService.deleteMemo(memoId);
      
      // 메모 다시 로드 (WebSocket 응답에서도 loadMemoFlow 호출됨)
      // await this.loadMemoFlow();
      
      alert('메모가 삭제되었습니다.');
    } catch (error) {
      console.error('메모 삭제 오류:', error);
      alert('메모 삭제 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    }
  }

  /**
   * 날짜 변경 감지 시작
   */
  startDateChangeDetection() {
    // 1분마다 날짜 확인
    this.dateChangeIntervalId = setInterval(() => {
      const today = new Date().toISOString().split('T')[0];
      if (this.currentDate !== today) {
        // 날짜가 변경되었으면 오늘 날짜로 자동 전환
        this.loadMemoFlow(today);
      }
    }, 60000); // 1분
  }

  /**
   * 로딩 상태 설정
   * @param {boolean} loading - 로딩 여부
   */
  setLoading(loading) {
    if (this.loadingSpinner) {
      this.loadingSpinner.style.display = loading ? 'flex' : 'none';
    }
  }

  /**
   * 빈 상태 표시
   */
  showEmptyState() {
    if (this.emptyState) {
      this.emptyState.style.display = 'block';
    }
    if (this.memoList) {
      this.memoList.style.display = 'none';
    }
  }

  /**
   * 빈 상태 숨김
   */
  hideEmptyState() {
    if (this.emptyState) {
      this.emptyState.style.display = 'none';
    }
    if (this.memoList) {
      this.memoList.style.display = 'grid';
    }
  }
  
  /**
   * 특정 페이지로 이동
   * @param {number} page - 이동할 페이지 번호
   */
  goToPage(page) {
    if (page < 1 || page > this.totalPages) {
      return;
    }
    
    this.currentPage = page;
    
    // 메모 다시 로드하여 현재 페이지의 메모만 표시
    this.loadMemoFlow();
  }
  
  /**
   * 페이지네이션 UI 업데이트
   */
  updatePagination() {
    if (!this.memoPagination || !this.btnPrevPage || !this.btnNextPage || !this.paginationInfo) {
      return;
    }
    
    // 메모가 없으면 페이지네이션 숨김
    if (this.memos.length === 0) {
      this.memoPagination.style.display = 'none';
      return;
    }
    
    // 페이지네이션 표시
    this.memoPagination.style.display = 'flex';
    
    // 이전/다음 버튼 활성화 상태 업데이트
    this.btnPrevPage.disabled = this.currentPage <= 1;
    this.btnNextPage.disabled = this.currentPage >= this.totalPages;
    
    // 페이지 정보 업데이트
    this.paginationInfo.textContent = `${this.currentPage} / ${this.totalPages}`;
  }

  /**
   * 컴포넌트 정리 (구독 해제 및 리소스 정리)
   */
  destroy() {
    // WebSocket 연결 해제
    if (this.wsUpdateDebounceTimer) {
      clearTimeout(this.wsUpdateDebounceTimer);
      this.wsUpdateDebounceTimer = null;
    }
    if (webSocketService.isConnected()) {
      webSocketService.disconnect();
    }
    this.wsConnected = false;
    
    // 모든 이벤트 구독 해제
    if (this.unsubscribers) {
      this.unsubscribers.forEach(unsubscribe => unsubscribe());
      this.unsubscribers = [];
    }
    
    // 모든 이벤트 리스너 제거
    if (this.eventListeners) {
      this.eventListeners.forEach(({ element, event, handler }) => {
        if (element && handler) {
          element.removeEventListener(event, handler);
        }
      });
      this.eventListeners = [];
    }
    
    // 날짜 변경 감지 인터벌 정리
    if (this.dateChangeIntervalId) {
      clearInterval(this.dateChangeIntervalId);
      this.dateChangeIntervalId = null;
    }
    
    // 컴포넌트 정리
    if (this.bookSelector && typeof this.bookSelector.destroy === 'function') {
      this.bookSelector.destroy();
    }
    if (this.memoEditor && typeof this.memoEditor.destroy === 'function') {
      this.memoEditor.destroy();
    }
    if (this.calendarModal && typeof this.calendarModal.destroy === 'function') {
      this.calendarModal.destroy();
    }
    
    // 참조 정리
    this.handleCalendarClick = null;
    this.handleInlineCalendarClick = null;
    this.handleGroupingToggleClick = null;
    this.handleTagCategoryToggleClick = null;
    this.handleSelectBookClick = null;
    this.handleHomeClick = null;
    this.handleMemoListClick = null;
  }

  /**
   * 책 덮기 버튼 클릭 처리
   */
  handleCloseBookClick = () => {
    if (!this.selectedBook || !this.selectedBookId) {
      alert('책을 먼저 선택해주세요.');
      return;
    }
    
    // 메모 작성 UI 강제로 숨김
    this.hideMemoEditor();
    
    this.showCloseBookModal();
  }

  /**
   * 책 덮기 모달 표시
   */
  showCloseBookModal() {
    if (!this.closeBookModal || !this.selectedBook) return;
    
    // 현재 읽은 페이지 수와 전체 페이지 수 설정
    if (this.closeBookProgress) {
      this.closeBookProgress.value = this.selectedBook.readingProgress || '';
    }
    
    if (this.closeBookTotalPages) {
      const totalPages = this.selectedBook.totalPages || 0;
      this.closeBookTotalPages.textContent = totalPages > 0 
        ? `전체 페이지: ${totalPages}페이지` 
        : '';
    }
    
    // Finished 필드 초기화 및 숨김
    if (this.closeBookFinishedFields) {
      this.closeBookFinishedFields.style.display = 'none';
    }
    if (this.closeBookFinishedDate) {
      this.closeBookFinishedDate.value = '';
    }
    if (this.closeBookRating) {
      this.closeBookRating.value = '0';
    }
    if (this.closeBookRatingStars) {
      this.closeBookRatingStars.setAttribute('data-rating', '0');
      this.closeBookRatingStars.querySelectorAll('.star').forEach(star => {
        star.classList.remove('active');
      });
    }
    if (this.closeBookReview) {
      this.closeBookReview.value = '';
    }
    
    // 별점 입력 초기화
    if (this.closeBookRatingStars) {
      this.initRatingStarsInput(this.closeBookRatingStars, this.closeBookRating);
    }
    
    // 모달 표시 (modal-overlay로 감싸져 있으므로 flex로 표시하고 show 클래스 추가)
    this.closeBookModal.style.display = 'flex';
    this.closeBookModal.classList.add('show');
    
    // 진행률 변경 감지하여 Finished 필드 표시/숨김
    if (this.closeBookProgress) {
      this.closeBookProgress.addEventListener('input', this.handleCloseBookProgressChange);
    }
  }

  /**
   * 책 덮기 모달 숨김
   */
  hideCloseBookModal() {
    if (!this.closeBookModal) return;
    
    this.closeBookModal.classList.remove('show');
    this.closeBookModal.style.display = 'none';
    
    // 입력 필드 초기화
    if (this.closeBookProgress) {
      this.closeBookProgress.value = '';
      this.closeBookProgress.removeEventListener('input', this.handleCloseBookProgressChange);
    }
    if (this.closeBookFinishedFields) {
      this.closeBookFinishedFields.style.display = 'none';
    }
    if (this.closeBookFinishedDate) {
      this.closeBookFinishedDate.value = '';
    }
    if (this.closeBookRating) {
      this.closeBookRating.value = '0';
    }
    if (this.closeBookReview) {
      this.closeBookReview.value = '';
    }
  }

  /**
   * 책 덮기 진행률 변경 처리 (Finished 필드 표시/숨김)
   */
  handleCloseBookProgressChange = () => {
    if (!this.closeBookProgress || !this.closeBookFinishedFields || !this.selectedBook) return;
    
    const lastReadPage = parseInt(this.closeBookProgress.value) || 0;
    const totalPages = this.selectedBook.totalPages || 0;
    
    // 진행률이 100%인 경우 Finished 필드 표시
    if (totalPages > 0 && lastReadPage >= totalPages) {
      this.closeBookFinishedFields.style.display = 'block';
      
      // 독서 종료일 기본값을 오늘 날짜로 설정
      if (this.closeBookFinishedDate) {
        const today = new Date().toISOString().split('T')[0];
        this.closeBookFinishedDate.value = today;
      }
      
      // 필수 필드 검증 활성화
      if (this.closeBookFinishedDate) {
        this.closeBookFinishedDate.required = true;
      }
      if (this.closeBookRating) {
        this.closeBookRating.required = true;
      }
    } else {
      this.closeBookFinishedFields.style.display = 'none';
      
      // 필수 필드 검증 비활성화
      if (this.closeBookFinishedDate) {
        this.closeBookFinishedDate.required = false;
      }
      if (this.closeBookRating) {
        this.closeBookRating.required = false;
      }
    }
  }

  /**
   * 별점 입력 초기화
   */
  initRatingStarsInput(starsContainer, hiddenInput) {
    if (!starsContainer || !hiddenInput) return;
    
    // 기존 이벤트 리스너 제거 (중복 방지)
    const existingHandler = starsContainer._ratingHandler;
    if (existingHandler) {
      starsContainer.removeEventListener('click', existingHandler);
      starsContainer.removeEventListener('mouseleave', existingHandler);
    }
    
    let currentRating = parseInt(starsContainer.getAttribute('data-rating')) || 0;
    
    // 클릭 이벤트 핸들러
    const handleStarClick = (e) => {
      const star = e.target.closest('.star');
      if (!star) return;
      
      const value = parseInt(star.getAttribute('data-value'), 10);
      if (isNaN(value) || value < 1 || value > 5) return;
      
      currentRating = value;
      hiddenInput.value = currentRating;
      starsContainer.setAttribute('data-rating', currentRating);
      this.updateRatingStars(starsContainer, currentRating);
    };
    
    // 마우스 오버 이벤트 (호버 효과)
    const handleStarHover = (e) => {
      const star = e.target.closest('.star');
      if (!star) {
        // 마우스가 별 영역을 벗어나면 현재 선택된 평점으로 복원
        this.updateRatingStars(starsContainer, currentRating);
        return;
      }
      
      const value = parseInt(star.getAttribute('data-value'), 10);
      if (isNaN(value) || value < 1 || value > 5) return;
      
      // 호버 시 미리보기 (실제 선택은 아님)
      this.updateRatingStars(starsContainer, value);
    };
    
    // 마우스 리브 이벤트
    const handleMouseLeave = () => {
      this.updateRatingStars(starsContainer, currentRating);
    };
    
    // 이벤트 리스너 등록
    starsContainer.addEventListener('click', handleStarClick);
    starsContainer.addEventListener('mouseover', handleStarHover);
    starsContainer.addEventListener('mouseleave', handleMouseLeave);
    
    // 참조 저장 (나중에 제거하기 위해)
    starsContainer._ratingHandler = handleStarClick;
    
    // 초기 별점 표시
    this.updateRatingStars(starsContainer, currentRating);
  }

  /**
   * 별점 업데이트
   */
  updateRatingStars(starsContainer, rating) {
    const stars = starsContainer.querySelectorAll('.star');
    stars.forEach((star) => {
      const value = parseInt(star.getAttribute('data-value'), 10);
      if (value <= rating) {
        star.classList.add('active');
        star.textContent = '★';
      } else {
        star.classList.remove('active');
        star.textContent = '☆';
      }
    });
  }

  /**
   * 책 덮기 확인 처리
   */
  handleCloseBookConfirm = async () => {
    if (!this.selectedBook || !this.selectedBookId) {
      alert('책을 먼저 선택해주세요.');
      return;
    }
    
    // 입력값 검증
    const lastReadPage = parseInt(this.closeBookProgress?.value) || 0;
    if (lastReadPage < 1) {
      alert('현재 읽은 페이지 수를 입력해주세요.');
      return;
    }
    
    const totalPages = this.selectedBook.totalPages || 0;
    if (totalPages > 0 && lastReadPage > totalPages) {
      alert(`페이지 수는 전체 페이지 수(${totalPages}페이지)를 초과할 수 없습니다.`);
      return;
    }
    
    // 진행률이 100%인 경우 Finished 필드 검증
    const isFinished = totalPages > 0 && lastReadPage >= totalPages;
    if (isFinished) {
      const finishedDate = this.closeBookFinishedDate?.value;
      if (!finishedDate) {
        alert('독서 종료일을 입력해주세요.');
        return;
      }
      
      const rating = parseInt(this.closeBookRating?.value) || 0;
      if (rating < 1 || rating > 5) {
        alert('평점을 선택해주세요. (1~5점)');
        return;
      }
    }
    
    try {
      // API 호출 데이터 준비
      const requestData = {
        lastReadPage: lastReadPage
      };
      
      // Finished 카테고리로 변경될 경우 추가 필드 포함
      if (isFinished) {
        requestData.readingFinishedDate = this.closeBookFinishedDate?.value;
        requestData.rating = parseInt(this.closeBookRating?.value) || 0;
        requestData.review = this.closeBookReview?.value || null;
      }
      
      // WebSocket으로 책 업데이트 (책 덮기)
      await webSocketService.updateUserShelfBook(this.selectedBookId, {
        readingProgress: lastReadPage,
        category: isFinished ? 'Finished' : (lastReadPage > 0 ? 'Reading' : undefined),
        readingFinishedDate: isFinished ? this.closeBookFinishedDate?.value : undefined,
        rating: isFinished ? (parseInt(this.closeBookRating?.value) || 0) : undefined,
        review: isFinished ? (this.closeBookReview?.value || null) : undefined,
      });
      
      // 성공 메시지
      alert('책 덮기가 완료되었습니다.');
      
      // 모달 닫기
      this.hideCloseBookModal();
      
      // 선택된 책 초기화
      this.selectedBook = null;
      this.selectedBookId = null;
      
      // 선택된 책 정보 숨김
      if (this.selectedBookInfo) {
        this.selectedBookInfo.style.display = 'none';
      }
      
      // 메모 에디터 숨김
      this.hideMemoEditor();
      
      // 메모 목록 다시 로드
      await this.loadMemoFlow();
      
    } catch (error) {
      console.error('책 덮기 오류:', error);
      alert('책 덮기 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    }
  }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  new FlowView();
});

export default FlowView;

