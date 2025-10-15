// 이벤트 타입과 파라미터 타입 설정

// 이벤트 타입 목록
export const EVENT_TYPES = [
    'camera',
    'background',
    'character',
    'overlay',
    'startrail',
    'custom',
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
        'rotate',
        'position_from_character',
        'position_from_time',
        'position_off'
    ],
    'background': [
        'return_default',
        'reset',
        'replace_image',
        'glitch',
        'hologram'
    ],
    'character': [
        'clear',
        'glitch',
        'hologram'
    ],
    'overlay': [
        'clear',
        'color',
        'glitch',
        'hologram',
        'fog',
        'illusion',
        'flame',
        'replace_image',
        'setadditive'
    ],
    'speedshift': [
        'speedup',
        'speeddown'
    ],
    'startrail': [
        'defaultstar',
        'startrail'
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
    'camera-position_from_character': [
        { paramName: 'offset_x', paramType: 'float' },
        { paramName: 'offset_y', paramType: 'float' },
    ],
    'camera-position_from_time': [
        { paramName: 'offset_x', paramType: 'float' },
        { paramName: 'offset_y', paramType: 'float' },
        { paramName: 'time1', paramType: 'float' },
        { paramName: 'time2', paramType: 'float' },
        { paramName: 'time3', paramType: 'float' },
        { paramName: 'time4', paramType: 'float' },
    ],
    'camera-position_off': [
        { paramName: 'fade', paramType: 'float' },
    ],

    // background 타입 이벤트
    'background-replace_image': [
        { paramName: 'image_name', paramType: 'string' },
    ],
    'background-glitch': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'background-hologram': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],

    // character 타입 이벤트
    'character-clear': [
    ],
    'character-glitch': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'character-hologram': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],

    // overlay 타입 이벤트
    'overlay-clear': [
    ],
    'overlay-color': [
        { paramName: 'red', paramType: 'int' },
        { paramName: 'green', paramType: 'int' },
        { paramName: 'blue', paramType: 'int' },
        { paramName: 'alpha', paramType: 'int' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'overlay-glitch': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'overlay-hologram': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'overlay-fog': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'overlay-illusion': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' }
    ],
    'overlay-flame': [
        { paramName: 'enable', paramType: 'bool' },
        { paramName: 'area', paramType: 'float' }
    ],
    'overlay-setadditive': [
        { paramName: 'istrue', paramType: 'bool' },
    ],
    'overlay-replace_image': [
        { paramName: 'image_name', paramType: 'string' },
    ],

    'startrail-defaultstar': [],
    'startrail-startrail': [],
};

// 이벤트 타입별 설명 (선택사항)
export const EVENT_TYPE_DESCRIPTIONS = {
    'camera': '카메라 제어 관련 이벤트',
    'background': '배경 및 시각적 효과 관련 이벤트',
    'character': '캐릭터 관련 이벤트',
    'overlay': '오버레이 패널 시각 효과 관련 이벤트',
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