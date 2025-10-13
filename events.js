// 이벤트 관리 관련 함수들
import {
    EVENT_TYPES,
    PARAM_TYPES,
    EVENT_TYPE_DESCRIPTIONS,
    PARAM_TYPE_DESCRIPTIONS,
    EVENT_IDS_BY_TYPE,
    PREDEFINED_PARAMS_BY_EVENT_ID
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

// 특정 이벤트 ID에 대한 사전 정의된 파라미터 목록 가져오기
export function getPredefinedParamsForEventId(eventType, eventId) {
    if (!eventType || !eventId) return [];

    const fullEventKey = `${eventType}-${eventId}`;
    return PREDEFINED_PARAMS_BY_EVENT_ID[fullEventKey] || [];
}

// 이벤트에 사전 정의된 파라미터들을 자동으로 추가하는 함수
export function applyPredefinedParams(eventIndex) {
    if (eventIndex < 0 || eventIndex >= events.length) return;

    const event = events[eventIndex];
    const predefinedParams = getPredefinedParamsForEventId(event.eventType, event.eventId);

    if (predefinedParams.length === 0) return;

    // 기존 파라미터들의 이름 목록을 가져옴
    const existingParamNames = event.eventParams.map(param => param.paramName);

    // 사전 정의된 파라미터 중 아직 존재하지 않는 것들만 추가
    predefinedParams.forEach(predefinedParam => {
        if (!existingParamNames.includes(predefinedParam.paramName)) {
            event.eventParams.push({
                paramType: predefinedParam.paramType,
                paramName: predefinedParam.paramName,
                paramValue: getDefaultValueForParamType(predefinedParam.paramType)
            });
        }
    });
}

// 파라미터 타입에 따른 기본값 반환
function getDefaultValueForParamType(paramType) {
    switch (paramType) {
        case 'float':
            return '0.0';
        case 'int':
            return '0';
        case 'string':
            return '';
        case 'bool':
            return 'false';
        case 'vector3':
            return '0.0,0.0,0.0';
        case 'vector2':
            return '0.0,0.0';
        case 'color':
            return '#FFFFFF';
        case 'enum':
            return '';
        default:
            return '';
    }
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

// 특정 인덱스에 이벤트 삽입
export function insertEvent(index, event) {
    if (index < 0 || index > events.length) {
        return false;
    }
    events.splice(index, 0, event);
    return true;
}

// 다중 이벤트를 특정 인덱스부터 삽입
export function insertMultipleEvents(startIndex, eventsToInsert) {
    if (startIndex < 0 || startIndex > events.length || !Array.isArray(eventsToInsert)) {
        return [];
    }

    const insertedIndices = [];
    eventsToInsert.forEach((event, i) => {
        const insertIndex = startIndex + i;
        events.splice(insertIndex, 0, event);
        insertedIndices.push(insertIndex);
    });

    return insertedIndices;
}

// 특정 인덱스의 이벤트 가져오기
export function getEventAtIndex(index) {
    if (index >= 0 && index < events.length) {
        return events[index];
    }
    return null;
}

// 이벤트 업데이트
export function updateEvent(index, updatedEvent) {
    if (index >= 0 && index < events.length) {
        events[index] = { ...updatedEvent };
        return true;
    }
    return false;
}

// 다중 이벤트 업데이트
export function updateMultipleEvents(updates) {
    let success = true;
    updates.forEach(({ index, event }) => {
        if (index >= 0 && index < events.length) {
            events[index] = { ...event };
        } else {
            success = false;
        }
    });
    return success;
}