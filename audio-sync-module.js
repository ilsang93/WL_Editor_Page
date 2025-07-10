/**
 * 전통적인 JavaScript 스타일의 오디오 동기화 모듈
 * 기존 script.js와 호환되는 스타일로 작성
 */

// =============================================================================
// 전역 네임스페이스 (기존 코드와 충돌 방지)
// =============================================================================

window.AudioSyncModule = window.AudioSyncModule || {};

(function() {
    'use strict';

    // =================================================================
    // 플랫폼 감지 유틸리티
    // =================================================================
    
    function detectPlatform() {
        var userAgent = navigator.userAgent.toLowerCase();
        var platform = navigator.platform.toLowerCase();
        
        var detectedPlatform = 'unknown';
        var browser = 'unknown';
        
        // 플랫폼 감지
        if (platform.indexOf('mac') !== -1 || userAgent.indexOf('mac') !== -1) {
            detectedPlatform = 'mac';
        } else if (platform.indexOf('win') !== -1 || userAgent.indexOf('windows') !== -1) {
            detectedPlatform = 'windows';
        } else if (platform.indexOf('linux') !== -1) {
            detectedPlatform = 'linux';
        }
        
        // 브라우저 감지
        if (userAgent.indexOf('chrome') !== -1) {
            browser = 'chrome';
        } else if (userAgent.indexOf('firefox') !== -1) {
            browser = 'firefox';
        } else if (userAgent.indexOf('safari') !== -1 && userAgent.indexOf('chrome') === -1) {
            browser = 'safari';
        }
        
        return {
            platform: detectedPlatform,
            browser: browser
        };
    }
    
    function getOptimizedSettings(platform) {
        var settings = {
            mac: {
                latencyHint: 0,
                sampleRate: 48000,
                expectedLatency: 0.003,
                baseOffset: 0
            },
            windows: {
                latencyHint: 'interactive',
                sampleRate: 44100,
                expectedLatency: 0.01,
                baseOffset: 0
            },
            linux: {
                latencyHint: 'balanced',
                sampleRate: 44100,
                expectedLatency: 0.035,
                baseOffset: 0
            }
        };
        
        return settings[platform] || settings.windows;
    }

    // =================================================================
    // 캘리브레이션 데이터 관리자
    // =================================================================
    
    function CalibrationDataManager() {
        this.STORAGE_KEY = 'rhythm_game_calibration_v2';
        this.data = this.loadData();
    }

    CalibrationDataManager.prototype.getDefaultData = function() {
        return {
            version: '2.0',
            userOffset: 0,
            platformOffsets: {
                mac: 0,
                windows: 0,
                linux: 0
            },
            chartOffsets: {},
            lastUpdated: new Date().toISOString()
        };
    };

    CalibrationDataManager.prototype.loadData = function() {
        try {
            var stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                var parsed = JSON.parse(stored);
                if (parsed.version === '2.0') {
                    return parsed;
                }
            }
        } catch (error) {
            console.warn('캘리브레이션 데이터 로드 실패:', error);
        }
        
        return this.getDefaultData();
    };

    CalibrationDataManager.prototype.saveData = function() {
        try {
            this.data.lastUpdated = new Date().toISOString();
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
            console.log('💾 캘리브레이션 데이터 저장됨');
        } catch (error) {
            console.error('캘리브레이션 데이터 저장 실패:', error);
        }
    };

    CalibrationDataManager.prototype.setUserOffset = function(offsetSeconds) {
        this.data.userOffset = offsetSeconds;
        this.saveData();
        console.log('🌍 사용자 오프셋 설정: ' + (offsetSeconds * 1000).toFixed(1) + 'ms');
    };

    CalibrationDataManager.prototype.setPlatformOffset = function(platform, offsetSeconds) {
        this.data.platformOffsets[platform] = offsetSeconds;
        this.saveData();
        console.log('🖥️ ' + platform + ' 오프셋 설정: ' + (offsetSeconds * 1000).toFixed(1) + 'ms');
    };

    CalibrationDataManager.prototype.setChartOffset = function(chartId, offsetSeconds) {
        this.data.chartOffsets[chartId] = {
            offset: offsetSeconds,
            lastCalibrated: new Date().toISOString()
        };
        this.saveData();
        console.log('📊 차트 오프셋 설정: ' + (offsetSeconds * 1000).toFixed(1) + 'ms');
    };

    CalibrationDataManager.prototype.getTotalOffset = function(platform, chartId) {
        var totalOffset = 0;
        
        // 사용자 글로벌 오프셋
        totalOffset += this.data.userOffset;
        
        // 플랫폼별 오프셋
        if (platform && this.data.platformOffsets[platform]) {
            totalOffset += this.data.platformOffsets[platform];
        }
        
        // 차트별 오프셋
        if (chartId && this.data.chartOffsets[chartId]) {
            totalOffset += this.data.chartOffsets[chartId].offset;
        }
        
        return totalOffset;
    };

    CalibrationDataManager.prototype.reset = function() {
        this.data = this.getDefaultData();
        this.saveData();
        console.log('🔄 캘리브레이션 데이터 리셋');
    };

    CalibrationDataManager.prototype.generateChartId = function(fileName, bpm, noteCount) {
        var name = fileName || 'unnamed';
        var id = name + '_' + bpm + '_' + noteCount;
        return id.substring(0, 30); // 30자로 제한
    };

    // =================================================================
    // 개선된 레이턴시 캘리브레이터
    // =================================================================
    
    function ImprovedCalibrator() {
        this.samples = [];
        this.calibrationOffset = 0;
        this.maxSamples = 20;
        this.systemLatency = 0;
        this.manualOffset = 0;
        
        this.dataManager = new CalibrationDataManager();
        this.currentPlatform = null;
        this.currentChartId = null;
    }

    ImprovedCalibrator.prototype.measureSystemLatency = function(audioContext) {
        try {
            console.log('🔍 시스템 레이턴시 측정 중...');
            
            var baseLatency = audioContext.baseLatency || 0;
            var outputLatency = audioContext.outputLatency || 0;
            
            this.systemLatency = baseLatency + outputLatency;
            
            console.log('📊 측정 결과: Base ' + (baseLatency * 1000).toFixed(1) + 'ms + Output ' + 
                       (outputLatency * 1000).toFixed(1) + 'ms = Total ' + 
                       (this.systemLatency * 1000).toFixed(1) + 'ms');
            
            return this.systemLatency;
            
        } catch (error) {
            console.warn('⚠️ 레이턴시 측정 실패:', error);
            return 0.02; // 기본값 20ms
        }
    };

    ImprovedCalibrator.prototype.setContext = function(platform, chartId) {
        this.currentPlatform = platform;
        this.currentChartId = chartId;
        
        // 저장된 오프셋 로드
        var totalOffset = this.dataManager.getTotalOffset(platform, chartId);
        this.calibrationOffset = totalOffset;
        
        console.log('🎯 컨텍스트 설정: ' + platform + ' / ' + (chartId || 'global'));
        console.log('📊 로드된 총 오프셋: ' + (totalOffset * 1000).toFixed(1) + 'ms');
    };

    ImprovedCalibrator.prototype.recordUserInput = function(inputTime, expectedTime) {
        var offset = inputTime - expectedTime;
        this.samples.push(offset);
        
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
        
        // 이상치 제거 후 평균 계산
        var sortedSamples = this.samples.slice().sort(function(a, b) { return a - b; });
        var trimStart = Math.floor(sortedSamples.length * 0.25);
        var trimEnd = Math.ceil(sortedSamples.length * 0.75);
        var trimmedSamples = sortedSamples.slice(trimStart, trimEnd);
        
        if (trimmedSamples.length > 0) {
            var sum = 0;
            for (var i = 0; i < trimmedSamples.length; i++) {
                sum += trimmedSamples[i];
            }
            this.calibrationOffset = sum / trimmedSamples.length;
        }
        
        console.log('🎯 캘리브레이션 업데이트: ' + (this.calibrationOffset * 1000).toFixed(1) + 'ms');
        return this.calibrationOffset;
    };

    ImprovedCalibrator.prototype.finishCalibrationSession = function() {
        if (this.samples.length === 0) return;
        
        // 캘리브레이션 결과 저장
        if (this.currentChartId) {
            this.dataManager.setChartOffset(this.currentChartId, this.calibrationOffset);
        } else if (this.currentPlatform) {
            this.dataManager.setPlatformOffset(this.currentPlatform, this.calibrationOffset);
        } else {
            this.dataManager.setUserOffset(this.calibrationOffset);
        }
        
        console.log('✅ 캘리브레이션 세션 완료 및 저장');
    };

    ImprovedCalibrator.prototype.setManualOffset = function(offsetSeconds) {
        this.manualOffset = offsetSeconds;
        this.dataManager.setUserOffset(offsetSeconds);
        console.log('🔧 수동 오프셋 설정: ' + (offsetSeconds * 1000).toFixed(1) + 'ms');
    };

    ImprovedCalibrator.prototype.getAdjustedTiming = function(originalTime) {
        return originalTime - this.systemLatency - this.calibrationOffset - this.manualOffset;
    };

    ImprovedCalibrator.prototype.getStatus = function() {
        return {
            systemLatency: this.systemLatency,
            calibrationOffset: this.calibrationOffset,
            manualOffset: this.manualOffset,
            totalOffset: this.systemLatency + this.calibrationOffset + this.manualOffset,
            sampleCount: this.samples.length,
            currentPlatform: this.currentPlatform,
            currentChartId: this.currentChartId
        };
    };

    ImprovedCalibrator.prototype.reset = function() {
        this.samples = [];
        this.calibrationOffset = 0;
        this.manualOffset = 0;
        this.dataManager.reset();
    };

    ImprovedCalibrator.prototype.getExportData = function() {
        return {
            calibrationData: {
                version: '2.0',
                userOffset: this.dataManager.data.userOffset,
                platformOffsets: this.dataManager.data.platformOffsets,
                exportedAt: new Date().toISOString()
            }
        };
    };

    ImprovedCalibrator.prototype.importFromJSON = function(calibrationData) {
        if (calibrationData && calibrationData.version === '2.0') {
            if (calibrationData.userOffset !== undefined) {
                this.dataManager.data.userOffset = calibrationData.userOffset;
            }
            
            if (calibrationData.platformOffsets) {
                for (var platform in calibrationData.platformOffsets) {
                    this.dataManager.data.platformOffsets[platform] = calibrationData.platformOffsets[platform];
                }
            }
            
            this.dataManager.saveData();
            console.log('📥 JSON에서 캘리브레이션 데이터 가져옴');
            return true;
        }
        
        return false;
    };

    // =================================================================
    // 캘리브레이션 UI
    // =================================================================
    
    function CalibrationUI(audioManager) {
        this.audioManager = audioManager;
        this.isCalibrating = false;
        this.calibrationCount = 0;
        this.targetCount = 10;
        this.nextBeatTime = 0;
        this.beatTimes = [];
        this.keyHandler = null;
        
        this.createUI();
    }

    CalibrationUI.prototype.createUI = function() {
        var html = [
            '<div id="audio-sync-panel" style="display: none; position: fixed; top: 20px; right: 20px; z-index: 10000;',
            'background: rgba(40, 40, 40, 0.95); padding: 20px; border-radius: 12px;',
            'border: 2px solid #4CAF50; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); min-width: 320px; color: #fff;">',
            
            '<h3 style="margin: 0 0 15px 0; color: #4CAF50; text-align: center;">🎵 오디오 캘리브레이션</h3>',
            
            '<div id="sync-status" style="margin-bottom: 15px; padding: 10px; background: rgba(0, 0, 0, 0.3); border-radius: 6px; font-size: 12px;">',
            '<div>플랫폼: <span id="platform-info" style="color: #4CAF50; font-weight: bold;">감지 중...</span></div>',
            '<div>시스템 레이턴시: <span id="system-latency" style="color: #4CAF50; font-weight: bold;">측정 중...</span></div>',
            '<div>현재 오프셋: <span id="current-offset" style="color: #4CAF50; font-weight: bold;">0ms</span></div>',
            '</div>',
            
            '<div style="margin-bottom: 15px;">',
            '<label style="display: block; margin-bottom: 8px; color: #ddd; font-size: 13px;">수동 오프셋 조정:</label>',
            '<input type="range" id="manual-offset-slider" min="-200" max="200" value="0" step="1" style="width: 100%; margin-bottom: 8px;">',
            '<div style="display: flex; justify-content: space-between; font-size: 11px; color: #999;">',
            '<span>-200ms</span>',
            '<span id="manual-offset-value" style="color: #4CAF50; font-weight: bold;">0ms</span>',
            '<span>+200ms</span>',
            '</div>',
            '</div>',
            
            '<button id="start-calibration" style="width: 100%; padding: 12px; margin-bottom: 10px; background: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">자동 캘리브레이션 시작</button>',
            
            '<div id="calibration-progress" style="display: none; margin-bottom: 15px; padding: 12px; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px; font-size: 12px; color: #ffc107; text-align: center;">',
            '<div style="margin-bottom: 8px;">🎵 메트로놈 소리에 맞춰 <strong>스페이스바</strong>를 정확히 눌러주세요</div>',
            '<div>진행률: <span id="progress-count" style="color: #fff; font-weight: bold;">0</span>/' + this.targetCount + '</div>',
            '</div>',
            
            '<div style="display: flex; gap: 10px;">',
            '<button id="reset-calibration" style="flex: 1; padding: 10px; background: #f44336; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">리셋</button>',
            '<button id="close-panel" style="flex: 1; padding: 10px; background: #666; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">닫기</button>',
            '</div>',
            
            '</div>'
        ].join('');
        
        document.body.insertAdjacentHTML('beforeend', html);
        this.setupEventListeners();
    };

    CalibrationUI.prototype.setupEventListeners = function() {
        var self = this;
        
        var manualSlider = document.getElementById('manual-offset-slider');
        var manualValue = document.getElementById('manual-offset-value');
        var startBtn = document.getElementById('start-calibration');
        var resetBtn = document.getElementById('reset-calibration');
        var closeBtn = document.getElementById('close-panel');

        // 수동 오프셋 조정
        manualSlider.addEventListener('input', function(e) {
            var value = parseInt(e.target.value);
            manualValue.textContent = value + 'ms';
            self.audioManager.calibrator.setManualOffset(value / 1000);
            self.updateStatus();
        });

        // 자동 캘리브레이션
        startBtn.addEventListener('click', function() {
            if (!self.isCalibrating) {
                self.startCalibration();
            } else {
                self.stopCalibration();
            }
        });

        // 리셋
        resetBtn.addEventListener('click', function() {
            self.audioManager.calibrator.reset();
            manualSlider.value = 0;
            manualValue.textContent = '0ms';
            self.updateStatus();
        });

        // 닫기
        closeBtn.addEventListener('click', function() {
            if (self.isCalibrating) self.stopCalibration();
            document.getElementById('audio-sync-panel').style.display = 'none';
        });

        // 키보드 이벤트 핸들러
        this.keyHandler = function(e) {
            if (e.code === 'Space' && self.isCalibrating) {
                e.preventDefault();
                self.recordCalibrationHit();
            }
        };
    };

    CalibrationUI.prototype.show = function() {
        document.getElementById('audio-sync-panel').style.display = 'block';
        this.updateStatus();
    };

    CalibrationUI.prototype.updateStatus = function() {
        var status = this.audioManager.calibrator.getStatus();
        var platformInfo = this.audioManager.platformInfo;
        
        document.getElementById('platform-info').textContent = 
            platformInfo.platform.toUpperCase() + ' / ' + platformInfo.browser;
        
        document.getElementById('system-latency').textContent = 
            (status.systemLatency * 1000).toFixed(1) + 'ms';
        
        document.getElementById('current-offset').textContent = 
            (status.totalOffset * 1000).toFixed(1) + 'ms';
    };

    CalibrationUI.prototype.startCalibration = function() {
        console.log('🎯 자동 캘리브레이션 시작');
        
        this.isCalibrating = true;
        this.calibrationCount = 0;
        this.beatTimes = [];
        
        var startBtn = document.getElementById('start-calibration');
        var progress = document.getElementById('calibration-progress');
        var progressCount = document.getElementById('progress-count');
        
        startBtn.textContent = '캘리브레이션 중지';
        startBtn.style.background = '#f44336';
        progress.style.display = 'block';
        progressCount.textContent = '0';
        
        // 키보드 이벤트 등록
        document.addEventListener('keydown', this.keyHandler);
        
        // 메트로놈 시작
        this.startMetronome();
    };

    CalibrationUI.prototype.stopCalibration = function() {
        console.log('🛑 캘리브레이션 중지');
        
        this.isCalibrating = false;
        
        var startBtn = document.getElementById('start-calibration');
        var progress = document.getElementById('calibration-progress');
        
        startBtn.textContent = '자동 캘리브레이션 시작';
        startBtn.style.background = '#2196F3';
        progress.style.display = 'none';
        
        // 키보드 이벤트 해제
        document.removeEventListener('keydown', this.keyHandler);
        
        this.updateStatus();
        
        // 캘리브레이션 완료 처리
        if (this.calibrationCount > 0) {
            this.audioManager.calibrator.finishCalibrationSession();
        }
    };

    CalibrationUI.prototype.startMetronome = function() {
        var self = this;
        var audioContext = this.audioManager.audioContext;
        var bpm = 120;
        var interval = 60 / bpm; // 0.5초
        
        this.nextBeatTime = audioContext.currentTime + 1.0; // 1초 후 시작
        
        function scheduleBeats() {
            if (!self.isCalibrating) return;
            
            var currentTime = audioContext.currentTime;
            var scheduleAhead = 0.1; // 100ms 미리 스케줄링
            
            while (self.nextBeatTime < currentTime + scheduleAhead) {
                self.scheduleMetronomeBeat(self.nextBeatTime);
                self.beatTimes.push(self.nextBeatTime);
                self.nextBeatTime += interval;
            }
            
            setTimeout(scheduleBeats, 25); // 25ms마다 체크
        }
        
        scheduleBeats();
    };

    CalibrationUI.prototype.scheduleMetronomeBeat = function(time) {
        var audioContext = this.audioManager.audioContext;
        
        // 간단한 비프음 생성
        var oscillator = audioContext.createOscillator();
        var gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, time);
        gainNode.gain.setValueAtTime(0.3, time);
        gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
        
        oscillator.start(time);
        oscillator.stop(time + 0.1);
    };

    CalibrationUI.prototype.recordCalibrationHit = function() {
        var inputTime = this.audioManager.audioContext.currentTime;
        
        // 가장 가까운 비트 찾기
        var closestBeat = null;
        var minDistance = Infinity;
        
        for (var i = 0; i < this.beatTimes.length; i++) {
            var beatTime = this.beatTimes[i];
            var distance = Math.abs(inputTime - beatTime);
            if (distance < minDistance && distance < 0.3) { // 300ms 허용 범위
                minDistance = distance;
                closestBeat = beatTime;
            }
        }
        
        if (closestBeat) {
            this.audioManager.calibrator.recordUserInput(inputTime, closestBeat);
            this.calibrationCount++;
            
            document.getElementById('progress-count').textContent = this.calibrationCount.toString();
            
            if (this.calibrationCount >= this.targetCount) {
                this.finishCalibration();
            }
            
            console.log('🎵 캘리브레이션 히트: ' + this.calibrationCount + '/' + this.targetCount);
        }
    };

    CalibrationUI.prototype.finishCalibration = function() {
        this.stopCalibration();
        
        var status = this.audioManager.calibrator.getStatus();
        var message = '🎉 캘리브레이션 완료!\n\n' +
                      '평균 오프셋: ' + (status.calibrationOffset * 1000).toFixed(1) + 'ms\n' +
                      '총 보정값: ' + (status.totalOffset * 1000).toFixed(1) + 'ms';
        
        alert(message);
        console.log('✅ 자동 캘리브레이션 완료:', status);
    };

    // =================================================================
    // 메인 오디오 매니저
    // =================================================================
    
    function AudioManager() {
        this.audioContext = null;
        this.calibrator = new ImprovedCalibrator();
        this.calibrationUI = null;
        this.platformInfo = null;
        this.isInitialized = false;
        this.originalFunctions = {};
        this.currentAudioFileName = null;
    }

    AudioManager.prototype.init = function() {
        var self = this;
        
        return new Promise(function(resolve, reject) {
            if (self.isInitialized) {
                console.log('⚠️ 이미 초기화됨');
                resolve(false);
                return;
            }

            try {
                console.log('🚀 개선된 오디오 시스템 초기화 중...');
                
                // 플랫폼 감지
                self.platformInfo = detectPlatform();
                console.log('🖥️ 플랫폼: ' + self.platformInfo.platform + ' / ' + self.platformInfo.browser);
                
                // 최적화된 AudioContext 생성
                var settings = getOptimizedSettings(self.platformInfo.platform);
                
                var AudioContextClass = window.AudioContext || window.webkitAudioContext;
                self.audioContext = new AudioContextClass({
                    latencyHint: settings.latencyHint,
                    sampleRate: settings.sampleRate
                });
                
                // 사용자 상호작용으로 컨텍스트 활성화
                if (self.audioContext.state === 'suspended') {
                    self.audioContext.resume().then(function() {
                        self.completeInit(resolve);
                    });
                } else {
                    self.completeInit(resolve);
                }
                
            } catch (error) {
                console.error('❌ 오디오 시스템 초기화 실패:', error);
                reject(error);
            }
        });
    };

    AudioManager.prototype.completeInit = function(resolve) {
        var self = this;
        
        // 시스템 레이턴시 측정
        this.calibrator.measureSystemLatency(this.audioContext);
        
        // 플랫폼 컨텍스트 설정
        this.calibrator.setContext(this.platformInfo.platform, null);
        
        // 캘리브레이션 UI 생성
        this.calibrationUI = new CalibrationUI(this);
        
        // 기존 함수들 후킹
        this.hookExistingFunctions();
        
        this.isInitialized = true;
        console.log('✅ 개선된 오디오 시스템 초기화 완료');
        
        resolve(true);
    };

    AudioManager.prototype.hookExistingFunctions = function() {
        var self = this;
        
        // 기존 checkNoteHits 함수 후킹
        if (window.checkNoteHits && typeof window.checkNoteHits === 'function') {
            this.originalFunctions.checkNoteHits = window.checkNoteHits;
            window.checkNoteHits = function(currentTime) {
                return self.improvedCheckNoteHits(currentTime);
            };
            console.log('🔗 checkNoteHits 함수 후킹 완료');
        }
        
        // 기존 함수들이 없으면 생성
        if (!window.beatToTime) {
            window.beatToTime = function(beat, bpm, subdivisions) {
                return (beat * 60) / (bpm * subdivisions);
            };
        }
        
        if (!window.getPreDelaySeconds) {
            window.getPreDelaySeconds = function() {
                var element = document.getElementById("pre-delay");
                return element ? parseInt(element.value || 0) / 1000 : 0;
            };
        }
    };

    AudioManager.prototype.improvedCheckNoteHits = function(currentTime) {
        // 기존 전역 변수들 사용
        var notes = window.notes || [];
        var playedNotes = window.playedNotes || new Set();
        var playNoteSound = window.playNoteSound || function() {};
        var highlightNoteHit = window.highlightNoteHit || function() {};
        
        var bpmElement = document.getElementById("bpm");
        var subdivisionsElement = document.getElementById("subdivisions");
        
        var bpm = parseFloat(bpmElement ? bpmElement.value : 120);
        var subdivisions = parseInt(subdivisionsElement ? subdivisionsElement.value : 16);
        var tolerance = 0.05;

        for (var i = 0; i < notes.length; i++) {
            var note = notes[i];
            var noteId = note.type + '-' + note.beat + '-' + i;

            if (playedNotes.has(noteId)) continue;

            var targetTime;
            
            if (note.beat === 0 && note.type === "direction") {
                targetTime = 0;
                if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
                    playedNotes.add(noteId);
                    highlightNoteHit(i);
                    console.log('🎯 0번 노트 통과: ' + currentTime.toFixed(3) + 's');
                }
                continue;
            } else {
                // 개선된 타이밍 계산
                var originalTime = window.beatToTime(note.beat, bpm, subdivisions);
                var preDelaySeconds = window.getPreDelaySeconds();
                var baseTime = originalTime + preDelaySeconds;
                
                // 레이턴시 보정 적용
                targetTime = this.calibrator.getAdjustedTiming(baseTime);
            }

            if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
                playNoteSound(note.type);
                playedNotes.add(noteId);
                highlightNoteHit(i);
                
                console.log('🎵 개선된 노트 히트: ' + note.type + ' beat ' + note.beat + 
                           ', 보정된 시간 ' + targetTime.toFixed(3) + 's');
            }
        }
    };

    AudioManager.prototype.setAudioFile = function(fileName, bpm, notes) {
        this.currentAudioFileName = fileName;
        var chartId = this.calibrator.dataManager.generateChartId(fileName, bpm, notes.length);
        this.calibrator.setContext(this.platformInfo.platform, chartId);
        
        console.log('🎵 차트 설정: ' + chartId);
    };

    AudioManager.prototype.showCalibrationUI = function() {
        if (this.calibrationUI) {
            this.calibrationUI.show();
        }
    };

    AudioManager.prototype.getStatus = function() {
        if (!this.isInitialized) return null;
        
        return {
            platform: this.platformInfo,
            audioContext: {
                state: this.audioContext.state,
                sampleRate: this.audioContext.sampleRate,
                baseLatency: this.audioContext.baseLatency,
                outputLatency: this.audioContext.outputLatency
            },
            calibration: this.calibrator.getStatus()
        };
    };

    AudioManager.prototype.getExportData = function() {
        return this.calibrator.getExportData();
    };

    AudioManager.prototype.importCalibrationFromJSON = function(data) {
        if (data && data.calibrationData) {
            var success = this.calibrator.importFromJSON(data.calibrationData);
            if (success && this.calibrationUI) {
                this.calibrationUI.updateStatus();
            }
            return success;
        }
        return false;
    };

    AudioManager.prototype.destroy = function() {
        if (!this.isInitialized) return;
        
        // 원본 함수 복원
        if (this.originalFunctions.checkNoteHits) {
            window.checkNoteHits = this.originalFunctions.checkNoteHits;
        }
        
        // AudioContext 정리
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        // UI 제거
        var panel = document.getElementById('audio-sync-panel');
        if (panel) {
            panel.remove();
        }
        
        this.isInitialized = false;
        console.log('🧹 오디오 시스템 정리 완료');
    };

    // =================================================================
    // 공개 API
    // =================================================================
    
    var audioManager = null;

    window.AudioSyncModule = {
        init: function() {
            if (audioManager) {
                console.log('⚠️ 이미 초기화된 오디오 매니저가 있습니다.');
                return Promise.resolve(false);
            }
            
            audioManager = new AudioManager();
            return audioManager.init().then(function(success) {
                if (success) {
                    // 전역 접근을 위한 참조 추가
                    window.improvedAudioManager = audioManager;
                    
                    // 캘리브레이션 버튼을 기존 UI에 추가
                    window.AudioSyncModule.addCalibrationButton();
                }
                
                return success;
            });
        },

        showCalibration: function() {
            if (audioManager) {
                audioManager.showCalibrationUI();
            } else {
                console.log('⚠️ 오디오 매니저가 초기화되지 않았습니다.');
            }
        },

        getStatus: function() {
            return audioManager ? audioManager.getStatus() : null;
        },

        destroy: function() {
            if (audioManager) {
                audioManager.destroy();
                audioManager = null;
                window.improvedAudioManager = null;
            }
        },

        addCalibrationButton: function() {
            var topBar = document.getElementById('top-bar');
            if (!topBar || document.getElementById('audio-calibration-btn')) return;
            
            var button = document.createElement('button');
            button.id = 'audio-calibration-btn';
            button.textContent = '🎵 오디오 캘리브레이션';
            button.style.background = '#4CAF50';
            button.style.color = 'white';
            button.style.border = '1px solid #45a049';
            button.style.fontWeight = 'bold';
            
            button.addEventListener('click', function() {
                window.AudioSyncModule.showCalibration();
            });
            
            topBar.appendChild(button);
            console.log('🎛️ 캘리브레이션 버튼 추가됨');
        },

        logStatus: function() {
            var status = this.getStatus();
            if (status) {
                console.log('=== 개선된 오디오 시스템 상태 ===');
                console.log('플랫폼:', status.platform);
                console.log('오디오 컨텍스트:', status.audioContext);
                console.log('캘리브레이션:', status.calibration);
            } else {
                console.log('오디오 시스템이 초기화되지 않았습니다.');
            }
        }
    };

    // =================================================================
    // 기존 코드와의 통합 헬퍼 함수들
    // =================================================================
    
    // 개선된 저장 함수 (전역으로 노출)
    window.improvedSaveToStorage = function() {
        var preDelayElement = document.getElementById("pre-delay");
        var preDelayValue = parseInt(preDelayElement ? preDelayElement.value : 0);
        
        var saveData = {
            notes: window.notes || [],
            audioFileName: window.savedAudioFile ? window.savedAudioFile.name : null,
            audioFileSize: window.savedAudioFile ? window.savedAudioFile.size : null,
            audioFileType: window.savedAudioFile ? window.savedAudioFile.type : null,
            preDelay: preDelayValue
        };
        
        // 캘리브레이션 데이터 포함
        if (window.improvedAudioManager) {
            var exportData = window.improvedAudioManager.getExportData();
            for (var key in exportData) {
                saveData[key] = exportData[key];
            }
        }
        
        localStorage.setItem("autosave_notes", JSON.stringify(saveData));
        console.log('💾 개선된 저장: 캘리브레이션 데이터 포함');
    };

    // 개선된 로드 함수 (전역으로 노출)
    window.improvedLoadFromStorage = function() {
        var saved = localStorage.getItem("autosave_notes");
        if (!saved) return;
        
        try {
            var parsed = JSON.parse(saved);

            if (Array.isArray(parsed)) {
                if (window.notes) {
                    window.notes.splice(0, window.notes.length);
                    for (var i = 0; i < parsed.length; i++) {
                        window.notes.push(parsed[i]);
                    }
                }
            } else if (parsed.notes && Array.isArray(parsed.notes)) {
                if (window.notes) {
                    window.notes.splice(0, window.notes.length);
                    for (var i = 0; i < parsed.notes.length; i++) {
                        window.notes.push(parsed.notes[i]);
                    }
                }

                // Pre-delay 설정 복원
                if (parsed.preDelay !== undefined) {
                    var preDelayElement = document.getElementById("pre-delay");
                    if (preDelayElement) {
                        preDelayElement.value = parsed.preDelay;
                    }
                }

                // 캘리브레이션 데이터 복원
                if (window.improvedAudioManager && parsed.calibrationData) {
                    window.improvedAudioManager.importCalibrationFromJSON(parsed);
                }

                // 오디오 파일 정보 복원
                if (parsed.audioFileName) {
                    window.savedAudioFile = {
                        name: parsed.audioFileName,
                        size: parsed.audioFileSize || 0,
                        type: parsed.audioFileType || 'audio/*'
                    };

                    // 차트 컨텍스트 설정
                    if (window.improvedAudioManager) {
                        var bpmElement = document.getElementById("bpm");
                        var bpm = parseFloat(bpmElement ? bpmElement.value : 120);
                        window.improvedAudioManager.setAudioFile(parsed.audioFileName, bpm, window.notes || []);
                    }
                }
            }
        } catch (e) {
            console.error("불러오기 실패:", e);
        }
    };

})();