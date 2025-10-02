// 이벤트 타입과 파라미터 타입 설정

// 이벤트 타입 목록
export const EVENT_TYPES = [
    'camera',
    'background',
    'custom'
];

// 파라미터 타입 목록
export const PARAM_TYPES = [
    'float',
    'int',
    'string',
    'bool',
    'vector3',
    'vector2',
    'color',
    'enum'
];

// 이벤트 타입별 사전 정의된 EventId 목록
export const EVENT_IDS_BY_TYPE = {
    'camera': [
        'focus_offset',
        "reset_camera",
        'zoom',
        'rotate'
    ],
    'background': [
        'return_default',
        'reset',
        'replace_image',
        'glitch',
    ],
    'custom': [] // custom 타입은 빈 배열 (텍스트 입력 사용)
};

// 이벤트 ID별 사전 정의된 파라미터 목록
export const PREDEFINED_PARAMS_BY_EVENT_ID = {
    // Camera 타입 이벤트들
    'camera-zoom': [
        { paramName: 'distance', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'camera-focus_offset': [
        { paramName: 'offset', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'camera-rotate': [
        { paramName: 'angle', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' },
        { paramName: 'isright', paramType: 'bool' },
    ],
    'camera-reset_camera': [
    ],

    // background 타입 이벤트
    'background-replace_image': [
        { paramName: 'image_name', paramType: 'string' },
    ],
    'background-glitch': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],


    // Background 타입 이벤트들
    'background-change_sprite': [
        { paramName: 'sprite_name', paramType: 'string' },
        { paramName: 'fade_duration', paramType: 'float' }
    ]
};

// 이벤트 타입별 설명 (선택사항)
export const EVENT_TYPE_DESCRIPTIONS = {
    'camera': '카메라 제어 관련 이벤트',
    'background': '배경 및 시각적 효과 관련 이벤트',
    'custom': '사용자 정의 이벤트 (직접 입력)'
};

// 파라미터 타입별 설명 (선택사항)
export const PARAM_TYPE_DESCRIPTIONS = {
    'float': '부동소수점 숫자 (예: 3.14, -2.5)',
    'int': '정수 (예: 1, 100, -5)',
    'string': '문자열 (예: "hello", "player_name")',
    'bool': '참/거짓 (true/false)',
    'vector3': '3D 벡터 (예: "1.0,2.0,3.0")',
    'vector2': '2D 벡터 (예: "1.0,2.0")',
    'color': '색상 (예: "#FF0000", "255,0,0")',
    'enum': '열거형 값 (사전 정의된 값 중 선택)'
};