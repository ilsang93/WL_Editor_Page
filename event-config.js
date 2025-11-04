// 이벤트 타입과 파라미터 타입 설정

// 이벤트 타입 목록
export const EVENT_TYPES = [
    'camera',
    'background',
    'character',
    'overlay',
    'startrail',
    'light',
    'system',
    'custom',
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
        'position',
        'damping',
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
        'startrail',
        'none'
    ],
    'light': [
        'setstatic',
        'setnote',
        'setchar'
    ],
    'system': [
        'dialog'
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
    'camera-position': [
        { paramName: 'x', paramType: 'float' },
        { paramName: 'y', paramType: 'float' },
    ],
    'camera-damping': [
        { paramName: 'multiplier', paramType: 'float' },
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
    'startrail-none': [],

    'light-setstatic': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' },
    ],
    'light-setnote': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' },
        { paramName: 'inner', paramType: 'float' },
        { paramName: 'outer', paramType: 'float' },
    ],
    'light-setchar': [
        { paramName: 'intensity', paramType: 'float' },
        { paramName: 'fade', paramType: 'float' },
        { paramName: 'inner', paramType: 'float' },
        { paramName: 'outer', paramType: 'float' },
    ],

    // system 타입 이벤트
    'system-dialog': [
        // dialog는 특별한 구조를 가지므로 여기서는 빈 배열
    ],
};

// Dialog 아이템 타입 목록
export const DIALOG_ITEM_TYPES = [
    'text',
    'character',
    'focus',
    'focusoff',
    'waitinput',
    'skip',
    'status'
];

// Dialog 아이템 타입별 필드 정의
export const DIALOG_ITEM_FIELDS = {
    'text': [
        { fieldName: 'value', fieldType: 'textarea', placeholder: '텍스트 내용' }
    ],
    'character': [
        { fieldName: 'value', fieldType: 'string', placeholder: '캐릭터 ID' }
    ],
    'focus': [
        { fieldName: 'value', fieldType: 'float', placeholder: '포커스 할 타겟 시간' }
    ],
    'focusoff': [
    ],
    'waitinput': [
        { fieldName: 'value', fieldType: 'string', placeholder: '입력 대기할 인풋값' }
    ],
    'skip': [
        { fieldName: 'value', fieldType: 'string', placeholder: '이동할 scene name' }
    ],
    'status': [
        { fieldName: 'value', fieldType: 'string', placeholder: '캐릭터 표정' }
    ]
};

// 이벤트 타입별 설명 (선택사항)
export const EVENT_TYPE_DESCRIPTIONS = {
    'camera': '카메라 제어 관련 이벤트',
    'background': '배경 및 시각적 효과 관련 이벤트',
    'character': '캐릭터 관련 이벤트',
    'overlay': '오버레이 패널 시각 효과 관련 이벤트',
    'custom': '사용자 정의 이벤트 (직접 입력)'
};