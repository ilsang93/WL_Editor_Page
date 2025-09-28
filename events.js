// 이벤트 관리 관련 함수들
import {
    EVENT_TYPES,
    PARAM_TYPES,
    EVENT_TYPE_DESCRIPTIONS,
    PARAM_TYPE_DESCRIPTIONS,
    EVENT_IDS_BY_TYPE
} from './event-config.js';

// 전역 이벤트 목록
const events = [];

// 이벤트 검증
export function validateEvent(event) {
    const errors = [];

    if (!event.eventType || typeof event.eventType !== 'string') {
        errors.push('Invalid event type');
    }

    if (!event.eventId || typeof event.eventId !== 'string') {
        errors.push('Invalid event ID');
    }

    if (typeof event.eventTime !== 'number' || isNaN(event.eventTime)) {
        errors.push('Invalid event time');
    }

    if (!Array.isArray(event.eventParams)) {
        errors.push('Event params must be an array');
    } else {
        event.eventParams.forEach((param, index) => {
            if (!param.paramType || !PARAM_TYPES.includes(param.paramType)) {
                errors.push(`Invalid param type at index ${index}`);
            }
            if (!param.paramName || typeof param.paramName !== 'string') {
                errors.push(`Invalid param name at index ${index}`);
            }
            if (param.paramValue === undefined || param.paramValue === null) {
                errors.push(`Invalid param value at index ${index}`);
            }
        });
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

// 새 이벤트 생성
export function createEvent() {
    return {
        eventType: EVENT_TYPES[0],
        eventId: '',
        eventTime: 0.0,
        eventParams: []
    };
}

// 새 파라미터 생성
export function createEventParam() {
    return {
        paramType: PARAM_TYPES[0],
        paramName: '',
        paramValue: ''
    };
}

// 이벤트 추가
export function addEvent(event = null) {
    const newEvent = event || createEvent();
    events.push(newEvent);
    return events.length - 1;
}

// 이벤트 삭제
export function removeEvent(index) {
    if (index >= 0 && index < events.length) {
        events.splice(index, 1);
        return true;
    }
    return false;
}

// 이벤트 파라미터 추가
export function addEventParam(eventIndex) {
    if (eventIndex >= 0 && eventIndex < events.length) {
        const newParam = createEventParam();
        events[eventIndex].eventParams.push(newParam);
        return events[eventIndex].eventParams.length - 1;
    }
    return -1;
}

// 이벤트 파라미터 삭제
export function removeEventParam(eventIndex, paramIndex) {
    if (eventIndex >= 0 && eventIndex < events.length) {
        const event = events[eventIndex];
        if (paramIndex >= 0 && paramIndex < event.eventParams.length) {
            event.eventParams.splice(paramIndex, 1);
            return true;
        }
    }
    return false;
}

// 이벤트를 시간순으로 정렬
export function sortEventsByTime() {
    events.sort((a, b) => a.eventTime - b.eventTime);
}

// 모든 이벤트 가져오기
export function getAllEvents() {
    return [...events];
}

// 모든 이벤트 클리어
export function clearAllEvents() {
    events.length = 0;
}

// 이벤트 복제
export function cloneEvent(event) {
    return {
        eventType: event.eventType,
        eventId: event.eventId,
        eventTime: event.eventTime,
        eventParams: event.eventParams.map(param => ({
            paramType: param.paramType,
            paramName: param.paramName,
            paramValue: param.paramValue
        }))
    };
}

// 이벤트 타입 목록 가져오기
export function getEventTypes() {
    return [...EVENT_TYPES];
}

// 파라미터 타입 목록 가져오기
export function getParamTypes() {
    return [...PARAM_TYPES];
}

// 이벤트 타입 설명 가져오기
export function getEventTypeDescription(eventType) {
    return EVENT_TYPE_DESCRIPTIONS[eventType] || '';
}

// 파라미터 타입 설명 가져오기
export function getParamTypeDescription(paramType) {
    return PARAM_TYPE_DESCRIPTIONS[paramType] || '';
}

// 이벤트 타입별 사전 정의된 EventId 목록 가져오기
export function getEventIdsByType(eventType) {
    return EVENT_IDS_BY_TYPE[eventType] || [];
}

// 이벤트 타입이 커스텀인지 확인
export function isCustomEventType(eventType) {
    return eventType === 'custom' || !EVENT_IDS_BY_TYPE[eventType] || EVENT_IDS_BY_TYPE[eventType].length === 0;
}

// 이벤트 리스트를 JSON으로 변환
export function eventsToJson() {
    return events.map(event => ({
        eventType: event.eventType,
        eventId: event.eventId,
        eventTime: event.eventTime,
        eventParams: event.eventParams.map(param => ({
            paramName: param.paramName,
            paramValue: param.paramValue
        }))
    }));
}

// JSON에서 이벤트 리스트 로드
export function loadEventsFromJson(jsonEvents) {
    clearAllEvents();
    if (Array.isArray(jsonEvents)) {
        jsonEvents.forEach(eventData => {
            const event = {
                eventType: eventData.eventType || EVENT_TYPES[0],
                eventId: eventData.eventId || '',
                eventTime: typeof eventData.eventTime === 'number' ? eventData.eventTime : 0.0,
                eventParams: Array.isArray(eventData.eventParams) ?
                    eventData.eventParams.map(param => ({
                        paramType: param.paramType || PARAM_TYPES[0],
                        paramName: param.paramName || '',
                        paramValue: param.paramValue || ''
                    })) : []
            };
            events.push(event);
        });
    }
}