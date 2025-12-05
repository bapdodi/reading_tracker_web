/**
 * 통합 WebSocket 서비스
 * STOMP over WebSocket을 사용한 실시간 동기화 서비스
 * 
 * 백엔드 SharedSync 컨트롤러들과 통신:
 * - UserShelfBook: /{roomId}/create/usershelfbook, read, update, delete
 * - Memo: /{roomId}/create/memo, read, update, delete
 */

import { tokenManager } from '../utils/token-manager.js';

// WebSocket 엔드포인트 설정
const WS_CONFIG = {
  endpoint: '/ws-sharedsync',
  reconnectDelay: 5000,
  heartbeatIncoming: 10000,
  heartbeatOutgoing: 10000,
};

// 연결 상태 enum
const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
};

// Application destination prefix used by Spring's @MessageMapping
const APP_PREFIX = window.WS_APP_PREFIX || '/app';

class WebSocketService {
  constructor() {
    this.stompClient = null;
    this.subscriptions = new Map(); // key -> subscription
    this.connectionState = ConnectionState.DISCONNECTED;
    this.eventHandlers = new Map(); // eventType -> Set<callback>
    this.pendingMessages = []; // 연결 전 대기 메시지
    this.currentRoomId = null; // userId를 roomId로 사용
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  /**
   * WebSocket 서버 URL 생성
   * @returns {string} WebSocket URL
   */
  _getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // API 서버가 다른 호스트인 경우 설정에서 가져오기
    const apiHost = window.API_BASE_URL 
      ? new URL(window.API_BASE_URL).host 
      : host;
    return `${protocol}//${apiHost}${WS_CONFIG.endpoint}`;
  }

  /**
   * STOMP 클라이언트 연결
   * @param {number} userId - 사용자 ID (roomId로 사용)
   * @returns {Promise<void>}
   */
  async connect(userId) {
    const roomId = userId; // userId를 roomId로 사용
    
    if (this.connectionState === ConnectionState.CONNECTED && this.currentRoomId === roomId) {
      console.log('[WS] Already connected to room:', roomId);
      return;
    }

    // 기존 연결 해제
    if (this.stompClient && this.connectionState !== ConnectionState.DISCONNECTED) {
      await this.disconnect();
    }

    this.currentRoomId = roomId;
    this.connectionState = ConnectionState.CONNECTING;
    this._emit('connectionStateChange', { state: this.connectionState });

    return new Promise((resolve, reject) => {
      try {
        const token = tokenManager && typeof tokenManager.getAccessToken === 'function'
          ? tokenManager.getAccessToken()
          : null;

        // Build SockJS URL (do NOT include token in query string for security)
        // Token will be sent in the STOMP CONNECT headers below as `Authorization: Bearer <token>`.
        const sockUrl = this._getWebSocketUrl().replace('ws:', 'http:').replace('wss:', 'https:');

        const socket = new SockJS(sockUrl);
        this.stompClient = Stomp.over(socket);

        // 디버그 로그 비활성화
        this.stompClient.debug = null;

        // STOMP 연결 헤더에 roomId 포함 (백엔드 SharedEventTracker에서 사용)
        // Token is sent here as `Authorization: Bearer <token>` so server/broker can authenticate.
        const headers = {
          roomId: String(roomId),
        };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        this.stompClient.connect(
          headers,
          // 연결 성공
          (frame) => {
            console.log('[WS] Connected:', frame);
            this.connectionState = ConnectionState.CONNECTED;
            this.reconnectAttempts = 0;
            this._emit('connectionStateChange', { state: this.connectionState });
            
            // 토픽 구독 (book, memo 모두)
            this._subscribeToRoom(roomId);
            
            // 대기 중인 메시지 전송
            this._flushPendingMessages();
            
            resolve();
          },
          // 연결 에러
          (error) => {
            console.error('[WS] Connection error:', error);
            this.connectionState = ConnectionState.DISCONNECTED;
            this._emit('connectionStateChange', { state: this.connectionState, error });
            this._emit('error', { type: 'connection', error });
            
            this._scheduleReconnect();
            reject(error);
          }
        );

        socket.onclose = () => {
          if (this.connectionState !== ConnectionState.DISCONNECTED) {
            console.log('[WS] Connection closed, attempting reconnect...');
            this.connectionState = ConnectionState.RECONNECTING;
            this._emit('connectionStateChange', { state: this.connectionState });
            this._scheduleReconnect();
          }
        };

      } catch (error) {
        console.error('[WS] Failed to create connection:', error);
        this.connectionState = ConnectionState.DISCONNECTED;
        reject(error);
      }
    });
  }

  /**
   * 방(토픽) 구독 - book과 memo 모두 구독
   * @param {number} roomId - 방 ID (사용자 ID)
   */
  _subscribeToRoom(roomId) {
    if (!this.stompClient || this.connectionState !== ConnectionState.CONNECTED) {
      return;
    }

    const actions = ['create', 'read', 'update', 'delete'];
    const entities = ['usershelfbook', 'memo'];
    
    entities.forEach(entity => {
      actions.forEach(action => {
        const destination = `/topic/${roomId}/${action}/${entity}`;
        const subscription = this.stompClient.subscribe(destination, (message) => {
          this._handleMessage(entity, action, message);
        });
        
        this.subscriptions.set(`${roomId}-${entity}-${action}`, subscription);
        console.log('[WS] Subscribed to:', destination);
      });
    });
  }

  /**
   * 수신 메시지 처리
   * @param {string} entity - 엔티티 타입 (usershelfbook/memo)
   * @param {string} action - 액션 타입 (create/read/update/delete)
   * @param {Object} message - STOMP 메시지
   */
  _handleMessage(entity, action, message) {
    try {
      const body = JSON.parse(message.body);
      console.log(`[WS] Received ${entity}:${action}:`, body);
      
      // 엔티티별 이벤트 발생 (기존 호환성 유지)
      const eventPrefix = entity === 'usershelfbook' ? 'book' : 'memo';
      this._emit(`${eventPrefix}:${action}`, body);
      
      // 공통 이벤트도 발생
      this._emit(`${eventPrefix}:message`, { action, data: body });
      
    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  }

  // ========== UserShelfBook (Book) 관련 메서드 ==========

  /**
   * 도서를 서재에 추가 요청
   * @param {Object} bookData - 도서 데이터
   * @returns {Promise<void>}
   */
  async createUserShelfBook(bookData) {
    const request = {
      userShelfBookDtos: [{
        cacheBookId: bookData.bookId,
        category: bookData.category || 'ToRead',
        expectation: bookData.expectation,
        readingStartDate: bookData.readingStartDate,
        readingProgress: bookData.readingProgress,
        purchaseType: bookData.purchaseType,
      }],
    };
    
    await this._send('usershelfbook', 'create', request);
  }

  /**
   * 도서 조회 요청
   * @param {Object} params - 조회 파라미터
   * @returns {Promise<void>}
   */
  async readUserShelfBook(params = {}) {
    const dto = {};
    if (params.userBookId !== undefined) dto.cacheUserShelfBookId = params.userBookId;
    if (params.cacheUserId !== undefined) dto.cacheUserId = params.cacheUserId;

    const request = {
      userShelfBookDtos: [dto],
    };

    if (params.date) {
      request.date = params.date;
    }

    await this._send('usershelfbook', 'read', request);
  }

  /**
   * 도서 정보 수정 요청
   * @param {number} userBookId - 사용자 도서 ID
   * @param {Object} updateData - 수정 데이터
   * @returns {Promise<void>}
   */
  async updateUserShelfBook(userBookId, updateData) {
    const request = {
      userShelfBookDtos: [{
        cacheUserShelfBookId: userBookId,
        category: updateData.category,
        expectation: updateData.expectation,
        readingStartDate: updateData.readingStartDate,
        readingProgress: updateData.readingProgress,
        purchaseType: updateData.purchaseType,
        readingFinishedDate: updateData.readingFinishedDate,
        rating: updateData.rating,
        review: updateData.review,
      }],
    };
    
    await this._send('usershelfbook', 'update', request);
  }

  /**
   * 도서 삭제 요청
   * @param {number} userBookId - 사용자 도서 ID
   * @returns {Promise<void>}
   */
  async deleteUserShelfBook(userBookId) {
    const request = {
      userShelfBookDtos: [{
        cacheUserShelfBookId: userBookId,
      }],
    };
    
    await this._send('usershelfbook', 'delete', request);
  }

  // ========== Memo 관련 메서드 ==========

  /**
   * 메모 생성 요청
   * @param {Object} memoData - 메모 데이터
   * @returns {Promise<void>}
   */
  async createMemo(memoData) {
    // Build DTO expected by backend: wrap fields inside memoDtos array
    const dto = {
      cacheUserShelfBookId: memoData.userBookId,
      content: memoData.content,
      pageNumber: memoData.pageNumber,
      tags: memoData.tags || [],
      memoStartTime: memoData.memoStartTime || new Date().toISOString(),
      tagCategory: memoData.tagCategory,
    };

    // include optional clientTempId for client-side optimistic create matching
    if (memoData.clientTempId) {
      dto.clientTempId = memoData.clientTempId;
      // Also set cacheMemoId to the temp id when client uses cacheMemoId for optimistic create
      dto.cacheMemoId = memoData.clientTempId;
    }

    const request = {
      memoDtos: [dto]
    };

    // propagate eventId if present to allow sender-side correlation
    if (memoData.eventId) {
      request.eventId = memoData.eventId;
    }

    await this._send('memo', 'create', request);
  }

  /**
   * 메모 조회 요청
   * @param {Object} params - 조회 파라미터
   * @returns {Promise<void>}
   */
  async readMemo(params = {}) {
    const dto = {};
    if (params.memoId !== undefined) dto.cacheMemoId = params.memoId;
    if (params.userBookId !== undefined) dto.cacheUserShelfBookId = params.userBookId;
    
    const request = {
      memoDtos: [dto],
    };
    
    if (params.date) {
      request.date = params.date;
    }
    
    await this._send('memo', 'read', request);
  }

  /**
   * 메모 수정 요청
   * @param {number} memoId - 메모 ID
   * @param {Object} memoData - 메모 수정 데이터
   * @returns {Promise<void>}
   */
  async updateMemo(memoId, memoData) {
    const dto = {
      cacheMemoId: memoId,
    };

    if (memoData.content !== undefined) dto.content = memoData.content;
    if (memoData.tags !== undefined) dto.tags = memoData.tags;
    if (memoData.tagCategory !== undefined) dto.tagCategory = memoData.tagCategory;

    const request = {
      memoDtos: [dto],
    };

    await this._send('memo', 'update', request);
  }

  /**
   * 메모 삭제 요청
   * @param {number} memoId - 메모 ID
   * @returns {Promise<void>}
   */
  async deleteMemo(memoIdOrArray) {
    // 백엔드의 MessageMapping이 memoDtos 형태를 기대하는 경우가 있어
    // 호환성을 위해 단일 ID와 배열 둘 다 처리합니다.
    let request;
    if (Array.isArray(memoIdOrArray)) {
      request = {
        memoDtos: memoIdOrArray.map(id => ({ cacheMemoId: id }))
      };
    } else {
      request = {
        memoDtos: [{ cacheMemoId: memoIdOrArray }]
      };
    }

    await this._send('memo', 'delete', request);
  }

  // ========== 공통 메서드 ==========

  /**
   * 메시지 전송
   * @param {string} entity - 엔티티 (usershelfbook/memo)
   * @param {string} action - 액션 (create/read/update/delete)
   * @param {Object} payload - 전송할 데이터
   */
  async _send(entity, action, payload) {
    const destination = `${APP_PREFIX}/${this.currentRoomId}/${action}/${entity}`;
    
    if (this.connectionState !== ConnectionState.CONNECTED) {
      console.warn('[WS] Not connected, queueing message:', entity, action);
      this.pendingMessages.push({ destination, payload });
      return;
    }

    try {
      this.stompClient.send(destination, {}, JSON.stringify(payload));
      console.log(`[WS] Sent ${entity}:${action}:`, payload);
    } catch (error) {
      console.error(`[WS] Failed to send ${entity}:${action}:`, error);
      this._emit('error', { type: 'send', entity, action, error });
      throw error;
    }
  }

  /**
   * 대기 중인 메시지 전송
   */
  _flushPendingMessages() {
    while (this.pendingMessages.length > 0) {
      const { destination, payload } = this.pendingMessages.shift();
      try {
        this.stompClient.send(destination, {}, JSON.stringify(payload));
        console.log('[WS] Flushed pending message:', destination);
      } catch (error) {
        console.error('[WS] Failed to flush message:', error);
      }
    }
  }

  /**
   * 재연결 스케줄링
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      this._emit('error', { type: 'maxReconnect' });
      return;
    }

    this.reconnectAttempts++;
    const delay = WS_CONFIG.reconnectDelay * this.reconnectAttempts;
    
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.currentRoomId && this.connectionState !== ConnectionState.CONNECTED) {
        this.connect(this.currentRoomId).catch(err => {
          console.error('[WS] Reconnect failed:', err);
        });
      }
    }, delay);
  }

  /**
   * 연결 해제
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.stompClient) {
      return;
    }

    this.subscriptions.forEach((subscription) => {
      try {
        subscription.unsubscribe();
      } catch (e) {
        // 이미 해제된 경우 무시
      }
    });
    this.subscriptions.clear();

    try {
      this.stompClient.disconnect(() => {
        console.log('[WS] Disconnected');
      });
    } catch (e) {
      console.warn('[WS] Disconnect error:', e);
    }

    this.stompClient = null;
    this.currentRoomId = null;
    this.connectionState = ConnectionState.DISCONNECTED;
    this._emit('connectionStateChange', { state: this.connectionState });
  }

  /**
   * 이벤트 핸들러 등록
   * @param {string} event - 이벤트 타입
   * @param {Function} callback - 콜백 함수
   * @returns {Function} 구독 해제 함수
   */
  on(event, callback) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(callback);
    
    return () => {
      this.eventHandlers.get(event)?.delete(callback);
    };
  }

  /**
   * 이벤트 핸들러 해제
   * @param {string} event - 이벤트 타입
   * @param {Function} [callback] - 콜백 함수
   */
  off(event, callback) {
    if (!callback) {
      this.eventHandlers.delete(event);
    } else {
      this.eventHandlers.get(event)?.delete(callback);
    }
  }

  /**
   * 이벤트 발생
   * @param {string} event - 이벤트 타입
   * @param {*} data - 이벤트 데이터
   */
  _emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[WS] Event handler error (${event}):`, error);
        }
      });
    }
  }

  /**
   * 현재 연결 상태 조회
   * @returns {string} ConnectionState
   */
  getConnectionState() {
    return this.connectionState;
  }

  /**
   * 연결 여부 확인
   * @returns {boolean}
   */
  isConnected() {
    return this.connectionState === ConnectionState.CONNECTED;
  }

  /**
   * 현재 방 ID (userId) 조회
   * @returns {number|null}
   */
  getCurrentRoomId() {
    return this.currentRoomId;
  }

  /**
   * 현재 사용자 ID 조회 (roomId와 동일)
   * @returns {number|null}
   */
  getCurrentUserId() {
    return this.currentRoomId;
  }
}

// 싱글톤 인스턴스 생성 및 export
export const webSocketService = new WebSocketService();

// 기존 호환성을 위한 alias export
export const bookWebSocketService = webSocketService;
export const memoWebSocketService = webSocketService;

// 상수 export
export { ConnectionState, WS_CONFIG };

