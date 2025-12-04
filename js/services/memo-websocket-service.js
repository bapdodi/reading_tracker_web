/**
 * 메모 WebSocket 서비스
 * STOMP over WebSocket을 사용한 실시간 메모 동기화 서비스
 * 
 * 백엔드 SharedMemoController와 통신:
 * - /{roomId}/create/memo
 * - /{roomId}/read/memo
 * - /{roomId}/update/memo
 * - /{roomId}/delete/memo
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

class MemoWebSocketService {
  constructor() {
    this.stompClient = null;
    this.subscriptions = new Map(); // roomId -> subscription
    this.connectionState = ConnectionState.DISCONNECTED;
    this.eventHandlers = new Map(); // eventType -> Set<callback>
    this.pendingMessages = []; // 연결 전 대기 메시지
    this.currentRoomId = null;
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
   * @param {number} roomId - 방 ID (사용자 ID 또는 그룹 ID)
   * @returns {Promise<void>}
   */
  async connect(roomId) {
    if (this.connectionState === ConnectionState.CONNECTED && this.currentRoomId === roomId) {
      console.log('[MemoWS] Already connected to room:', roomId);
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
        // SockJS + STOMP 사용 (글로벌로 로드된 라이브러리 사용)
        // tokenManager은 localStorage에서 access token을 읽어옵니다
        const token = tokenManager && typeof tokenManager.getAccessToken === 'function'
          ? tokenManager.getAccessToken()
          : null;

        // SockJS의 /info 요청은 STOMP CONNECT 이전에 발생합니다.
        // info 요청에 토큰을 포함시키려면 SockJS 생성 URL에 쿼리파라미터로 token을 추가합니다.
        let sockUrl = this._getWebSocketUrl().replace('ws:', 'http:').replace('wss:', 'https:');
        if (token) {
          sockUrl += (sockUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
        }

        const socket = new SockJS(sockUrl);
        this.stompClient = Stomp.over(socket);

        // 디버그 로그 비활성화 (필요시 활성화)
        this.stompClient.debug = null; // (msg) => console.log('[STOMP]', msg);

        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        this.stompClient.connect(
          headers,
          // 연결 성공
          (frame) => {
            console.log('[MemoWS] Connected:', frame);
            this.connectionState = ConnectionState.CONNECTED;
            this.reconnectAttempts = 0;
            this._emit('connectionStateChange', { state: this.connectionState });
            
            // 토픽 구독
            this._subscribeToRoom(roomId);
            
            // 대기 중인 메시지 전송
            this._flushPendingMessages();
            
            resolve();
          },
          // 연결 에러
          (error) => {
            console.error('[MemoWS] Connection error:', error);
            this.connectionState = ConnectionState.DISCONNECTED;
            this._emit('connectionStateChange', { state: this.connectionState, error });
            this._emit('error', { type: 'connection', error });
            
            // 재연결 시도
            this._scheduleReconnect();
            
            reject(error);
          }
        );

        // 연결 종료 핸들러
        socket.onclose = () => {
          if (this.connectionState !== ConnectionState.DISCONNECTED) {
            console.log('[MemoWS] Connection closed, attempting reconnect...');
            this.connectionState = ConnectionState.RECONNECTING;
            this._emit('connectionStateChange', { state: this.connectionState });
            this._scheduleReconnect();
          }
        };

      } catch (error) {
        console.error('[MemoWS] Failed to create connection:', error);
        this.connectionState = ConnectionState.DISCONNECTED;
        reject(error);
      }
    });
  }

  /**
   * 방(토픽) 구독
   * @param {number} roomId - 방 ID
   */
  _subscribeToRoom(roomId) {
    if (!this.stompClient || this.connectionState !== ConnectionState.CONNECTED) {
      return;
    }

    const topics = ['create', 'read', 'update', 'delete'];
    
    topics.forEach(action => {
      const destination = `/topic/${roomId}/${action}/memo`;
      const subscription = this.stompClient.subscribe(destination, (message) => {
        this._handleMessage(action, message);
      });
      
      this.subscriptions.set(`${roomId}-${action}`, subscription);
      console.log('[MemoWS] Subscribed to:', destination);
    });
  }

  /**
   * 수신 메시지 처리
   * @param {string} action - 액션 타입 (create/read/update/delete)
   * @param {Object} message - STOMP 메시지
   */
  _handleMessage(action, message) {
    try {
      const body = JSON.parse(message.body);
      console.log(`[MemoWS] Received ${action}:`, body);
      
      // 액션별 이벤트 발생
      this._emit(`memo:${action}`, body);
      
      // 공통 이벤트도 발생
      this._emit('memo:message', { action, data: body });
      
    } catch (error) {
      console.error('[MemoWS] Failed to parse message:', error);
    }
  }

  /**
   * 메모 생성 요청
   * @param {Object} memoData - 메모 데이터
   * @param {number} memoData.userBookId - 사용자 책 ID
   * @param {string} memoData.content - 메모 내용
   * @param {number} [memoData.pageNumber] - 페이지 번호
   * @param {Array<string>} [memoData.tags] - 태그 코드 리스트
   * @param {string} [memoData.memoStartTime] - 메모 시작 시간
   * @returns {Promise<void>}
   */
  async createMemo(memoData) {
    const request = {
      userBookId: memoData.userBookId,
      content: memoData.content,
      pageNumber: memoData.pageNumber,
      tags: memoData.tags || [],
      memoStartTime: memoData.memoStartTime || new Date().toISOString(),
      tagCategory: memoData.tagCategory,
    };
    
    await this._send('create', request);
  }

  /**
   * 메모 조회 요청
   * @param {Object} params - 조회 파라미터
   * @param {number} [params.memoId] - 메모 ID
   * @param {number} [params.userBookId] - 사용자 책 ID
   * @param {string} [params.date] - 조회할 날짜
   * @returns {Promise<void>}
   */
  async readMemo(params = {}) {
    const request = {
      memoId: params.memoId,
      userBookId: params.userBookId,
      date: params.date,
    };
    
    await this._send('read', request);
  }

  /**
   * 메모 수정 요청
   * @param {number} memoId - 메모 ID
   * @param {Object} memoData - 메모 수정 데이터
   * @param {string} [memoData.content] - 메모 내용
   * @param {Array<string>} [memoData.tags] - 태그 코드 리스트
   * @returns {Promise<void>}
   */
  async updateMemo(memoId, memoData) {
    const request = {
      memoId,
      content: memoData.content,
      tags: memoData.tags,
      tagCategory: memoData.tagCategory,
    };
    
    await this._send('update', request);
  }

  /**
   * 메모 삭제 요청
   * @param {number} memoId - 메모 ID
   * @returns {Promise<void>}
   */
  async deleteMemo(memoId) {
    const request = {
      memoId,
    };
    
    await this._send('delete', request);
  }

  /**
   * 메시지 전송
   * @param {string} action - 액션 (create/read/update/delete)
   * @param {Object} payload - 전송할 데이터
   */
  async _send(action, payload) {
    const destination = `/${this.currentRoomId}/${action}/memo`;
    
    if (this.connectionState !== ConnectionState.CONNECTED) {
      console.warn('[MemoWS] Not connected, queueing message:', action);
      this.pendingMessages.push({ destination, payload });
      return;
    }

    try {
      this.stompClient.send(destination, {}, JSON.stringify(payload));
      console.log(`[MemoWS] Sent ${action}:`, payload);
    } catch (error) {
      console.error(`[MemoWS] Failed to send ${action}:`, error);
      this._emit('error', { type: 'send', action, error });
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
        console.log('[MemoWS] Flushed pending message:', destination);
      } catch (error) {
        console.error('[MemoWS] Failed to flush message:', error);
      }
    }
  }

  /**
   * 재연결 스케줄링
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[MemoWS] Max reconnect attempts reached');
      this._emit('error', { type: 'maxReconnect' });
      return;
    }

    this.reconnectAttempts++;
    const delay = WS_CONFIG.reconnectDelay * this.reconnectAttempts;
    
    console.log(`[MemoWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.currentRoomId && this.connectionState !== ConnectionState.CONNECTED) {
        this.connect(this.currentRoomId).catch(err => {
          console.error('[MemoWS] Reconnect failed:', err);
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

    // 모든 구독 해제
    this.subscriptions.forEach((subscription) => {
      try {
        subscription.unsubscribe();
      } catch (e) {
        // 이미 해제된 경우 무시
      }
    });
    this.subscriptions.clear();

    // STOMP 연결 해제
    try {
      this.stompClient.disconnect(() => {
        console.log('[MemoWS] Disconnected');
      });
    } catch (e) {
      console.warn('[MemoWS] Disconnect error:', e);
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
    
    // 구독 해제 함수 반환
    return () => {
      this.eventHandlers.get(event)?.delete(callback);
    };
  }

  /**
   * 이벤트 핸들러 해제
   * @param {string} event - 이벤트 타입
   * @param {Function} [callback] - 콜백 함수 (없으면 해당 이벤트의 모든 핸들러 해제)
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
          console.error(`[MemoWS] Event handler error (${event}):`, error);
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
   * 현재 방 ID 조회
   * @returns {number|null}
   */
  getCurrentRoomId() {
    return this.currentRoomId;
  }
}

// 싱글톤 인스턴스 생성 및 export
export const memoWebSocketService = new MemoWebSocketService();

// 상수 export
export { ConnectionState, WS_CONFIG };

