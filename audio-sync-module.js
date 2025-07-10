/**
 * 완전한 오디오 동기화 모듈 (오류 수정 버전)
 * Mac 800ms 지연 문제 해결 + 캘리브레이션 시스템
 */

window.AudioSyncModule = window.AudioSyncModule || {};

(function() {
    'use strict';

    // =================================================================
    // 디버깅 시스템
    // =================================================================
    
    var DEBUG_MODE = true;
    
    function debugLog(message, data) {
        if (DEBUG_MODE) {
            console.log('[AudioSync] ' + message, data || '');
        }
    }

    // =================================================================
    // 플랫폼 감지
    // =================================================================
    
    function detectPlatform() {
        var userAgent = navigator.userAgent.toLowerCase();
        var platform = navigator.platform.toLowerCase();
        
        var detectedPlatform = 'unknown';
        var browser = 'unknown';
        
        if (platform.indexOf('mac') !== -1 || userAgent.indexOf('mac') !== -1) {
            detectedPlatform = 'mac';
        } else if (platform.indexOf('win') !== -1 || userAgent.indexOf('windows') !== -1) {
            detectedPlatform = 'windows';
        } else if (platform.indexOf('linux') !== -1) {
            detectedPlatform = 'linux';
        }
        
        if (userAgent.indexOf('chrome') !== -1) {
            browser = 'chrome';
        } else if (userAgent.indexOf('firefox') !== -1) {
            browser = 'firefox';
        } else if (userAgent.indexOf('safari') !== -1 && userAgent.indexOf('chrome') === -1) {
            browser = 'safari';
        }
        
        return { platform: detectedPlatform, browser: browser };
    }
    
    function getOptimizedSettings(platform) {
        var settings = {
            mac: { latencyHint: 0, sampleRate: 48000, expectedLatency: 0.003, baseOffset: 0 },
            windows: { latencyHint: 'interactive', sampleRate: 44100, expectedLatency: 0.01, baseOffset: 0 },
            linux: { latencyHint: 'balanced', sampleRate: 44100, expectedLatency: 0.035, baseOffset: 0 }
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
            platformOffsets: { mac: 0, windows: 0, linux: 0 },
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
            debugLog('캘리브레이션 데이터 로드 실패', error);
        }
        return this.getDefaultData();
    };

    CalibrationDataManager.prototype.saveData = function() {
        try {
            this.data.lastUpdated = new Date().toISOString();
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
            debugLog('캘리브레이션 데이터 저장됨');
        } catch (error) {
            console.error('캘리브레이션 데이터 저장 실패:', error);
        }
    };

    CalibrationDataManager.prototype.setUserOffset = function(offsetSeconds) {
        this.data.userOffset = offsetSeconds;
        this.saveData();
        debugLog('사용자 오프셋 설정: ' + (offsetSeconds * 1000).toFixed(1) + 'ms');
    };

    CalibrationDataManager.prototype.getTotalOffset = function(platform, chartId) {
        var totalOffset = 0;
        totalOffset += this.data.userOffset;
        if (platform && this.data.platformOffsets[platform]) {
            totalOffset += this.data.platformOffsets[platform];
        }
        if (chartId && this.data.chartOffsets[chartId]) {
            totalOffset += this.data.chartOffsets[chartId].offset;
        }
        return totalOffset;
    };

    CalibrationDataManager.prototype.reset = function() {
        this.data = this.getDefaultData();
        this.saveData();
        debugLog('캘리브레이션 데이터 리셋');
    };

    // =================================================================
    // 개선된 캘리브레이터
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
            var baseLatency = audioContext.baseLatency || 0;
            var outputLatency = audioContext.outputLatency || 0;
            this.systemLatency = baseLatency + outputLatency;
            debugLog('시스템 레이턴시 측정: ' + (this.systemLatency * 1000).toFixed(1) + 'ms');
            return this.systemLatency;
        } catch (error) {
            debugLog('레이턴시 측정 실패', error);
            return 0.02;
        }
    };

    ImprovedCalibrator.prototype.setContext = function(platform, chartId) {
        this.currentPlatform = platform;
        this.currentChartId = chartId;
        var totalOffset = this.dataManager.getTotalOffset(platform, chartId);
        this.calibrationOffset = totalOffset;
        debugLog('컨텍스트 설정: ' + platform + ', 오프셋: ' + (totalOffset * 1000).toFixed(1) + 'ms');
    };

    ImprovedCalibrator.prototype.recordUserInput = function(inputTime, expectedTime) {
        var offset = inputTime - expectedTime;
        this.samples.push(offset);
        
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
        
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
        
        debugLog('캘리브레이션 업데이트: ' + (this.calibrationOffset * 1000).toFixed(1) + 'ms');
        return this.calibrationOffset;
    };

    ImprovedCalibrator.prototype.finishCalibrationSession = function() {
        if (this.samples.length === 0) return;
        this.dataManager.setUserOffset(this.calibrationOffset);
        debugLog('캘리브레이션 세션 완료');
    };

    ImprovedCalibrator.prototype.setManualOffset = function(offsetSeconds) {
        this.manualOffset = offsetSeconds;
        this.dataManager.setUserOffset(offsetSeconds);
        debugLog('수동 오프셋 설정: ' + (offsetSeconds * 1000).toFixed(1) + 'ms');
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
            'background: rgba(40, 40, 40, 0.95); backdrop-filter: blur(10px); padding: 20px; border-radius: 12px;',
            'border: 2px solid #4CAF50; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); min-width: 320px; color: #fff;">',
            
            '<h3 style="margin: 0 0 15px 0; color: #4CAF50; text-align: center; border-bottom: 1px solid rgba(76, 175, 80, 0.3); padding-bottom: 10px;">',
            '🎵 오디오 동기화 캘리브레이션</h3>',
            
            '<div id="sync-status" style="margin-bottom: 15px; padding: 10px; background: rgba(0, 0, 0, 0.3); border-radius: 6px; font-size: 12px;">',
            '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">',
            '<span>플랫폼:</span><span id="platform-info" style="color: #4CAF50; font-weight: bold;">감지 중...</span></div>',
            '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">',
            '<span>시스템 레이턴시:</span><span id="system-latency" style="color: #4CAF50; font-weight: bold;">측정 중...</span></div>',
            '<div style="display: flex; justify-content: space-between;">',
            '<span>현재 오프셋:</span><span id="current-offset" style="color: #4CAF50; font-weight: bold;">0ms</span></div>',
            '</div>',
            
            '<div style="margin-bottom: 15px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">',
            '<label style="display: block; margin-bottom: 8px; color: #ddd; font-size: 13px; font-weight: bold;">',
            '수동 오프셋 조정 (-200ms ~ +200ms):</label>',
            '<input type="range" id="manual-offset-slider" min="-200" max="200" value="0" step="1"',
            'style="width: 100%; height: 6px; margin-bottom: 8px; background: rgba(255, 255, 255, 0.2); border-radius: 3px; outline: none;">',
            '<div style="display: flex; justify-content: space-between; font-size: 11px; color: #999;">',
            '<span>-200ms</span><span id="manual-offset-value" style="color: #4CAF50; font-weight: bold;">0ms</span><span>+200ms</span></div>',
            '</div>',
            
            '<button id="start-calibration" style="width: 100%; padding: 12px; margin-bottom: 10px; ',
            'background: linear-gradient(135deg, #2196F3, #1976D2); color: white; border: none; ',
            'border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">자동 캘리브레이션 시작</button>',
            
            '<div id="calibration-progress" style="display: none; margin-bottom: 15px; padding: 12px; ',
            'background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); ',
            'border-radius: 6px; font-size: 12px; color: #ffc107; text-align: center;">',
            '<div style="margin-bottom: 8px;">🎵 메트로놈 소리에 맞춰 <strong>스페이스바</strong>를 정확히 눌러주세요</div>',
            '<div>진행률: <span id="progress-count" style="color: #fff; font-weight: bold;">0</span>/' + this.targetCount + '</div></div>',
            
            '<div style="display: flex; gap: 10px;">',
            '<button id="reset-calibration" style="flex: 1; padding: 10px; background: linear-gradient(135deg, #f44336, #d32f2f); ',
            'color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">리셋</button>',
            '<button id="close-panel" style="flex: 1; padding: 10px; background: linear-gradient(135deg, #666, #555); ',
            'color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">닫기</button>',
            '</div></div>'
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

        if (manualSlider && manualValue) {
            manualSlider.addEventListener('input', function(e) {
                var value = parseInt(e.target.value);
                manualValue.textContent = value + 'ms';
                if (self.audioManager.calibrator) {
                    self.audioManager.calibrator.setManualOffset(value / 1000);
                }
                self.updateStatus();
            });
        }

        if (startBtn) {
            startBtn.addEventListener('click', function() {
                if (!self.isCalibrating) {
                    self.startCalibration();
                } else {
                    self.stopCalibration();
                }
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                if (self.audioManager.calibrator) {
                    self.audioManager.calibrator.reset();
                }
                if (manualSlider) manualSlider.value = 0;
                if (manualValue) manualValue.textContent = '0ms';
                self.updateStatus();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (self.isCalibrating) self.stopCalibration();
                document.getElementById('audio-sync-panel').style.display = 'none';
            });
        }

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
        if (!this.audioManager.calibrator) return;
        
        var status = this.audioManager.calibrator.getStatus();
        var platformInfo = this.audioManager.platformInfo;
        
        var platformInfoEl = document.getElementById('platform-info');
        var systemLatencyEl = document.getElementById('system-latency');
        var currentOffsetEl = document.getElementById('current-offset');
        
        if (platformInfoEl && platformInfo) {
            platformInfoEl.textContent = platformInfo.platform.toUpperCase() + ' / ' + platformInfo.browser;
        }
        
        if (systemLatencyEl && status) {
            systemLatencyEl.textContent = (status.systemLatency * 1000).toFixed(1) + 'ms';
        }
        
        if (currentOffsetEl && status) {
            currentOffsetEl.textContent = (status.totalOffset * 1000).toFixed(1) + 'ms';
        }
    };

    CalibrationUI.prototype.startCalibration = function() {
        debugLog('자동 캘리브레이션 시작');
        
        this.isCalibrating = true;
        this.calibrationCount = 0;
        this.beatTimes = [];
        
        var startBtn = document.getElementById('start-calibration');
        var progress = document.getElementById('calibration-progress');
        var progressCount = document.getElementById('progress-count');
        
        if (startBtn) {
            startBtn.textContent = '캘리브레이션 중지';
            startBtn.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
        }
        
        if (progress) progress.style.display = 'block';
        if (progressCount) progressCount.textContent = '0';
        
        document.addEventListener('keydown', this.keyHandler);
        this.startMetronome();
    };

    CalibrationUI.prototype.stopCalibration = function() {
        debugLog('캘리브레이션 중지');
        
        this.isCalibrating = false;
        
        var startBtn = document.getElementById('start-calibration');
        var progress = document.getElementById('calibration-progress');
        
        if (startBtn) {
            startBtn.textContent = '자동 캘리브레이션 시작';
            startBtn.style.background = 'linear-gradient(135deg, #2196F3, #1976D2)';
        }
        
        if (progress) progress.style.display = 'none';
        
        document.removeEventListener('keydown', this.keyHandler);
        this.updateStatus();
        
        if (this.calibrationCount > 0 && this.audioManager.calibrator) {
            this.audioManager.calibrator.finishCalibrationSession();
        }
    };

    CalibrationUI.prototype.startMetronome = function() {
        var self = this;
        var audioContext = this.audioManager.audioContext;
        
        if (!audioContext) {
            console.error('AudioContext가 없습니다.');
            return;
        }
        
        var bpm = 120;
        var interval = 60 / bpm;
        this.nextBeatTime = audioContext.currentTime + 1.0;
        
        function scheduleBeats() {
            if (!self.isCalibrating) return;
            
            var currentTime = audioContext.currentTime;
            var scheduleAhead = 0.1;
            
            while (self.nextBeatTime < currentTime + scheduleAhead) {
                self.scheduleMetronomeBeat(self.nextBeatTime);
                self.beatTimes.push(self.nextBeatTime);
                self.nextBeatTime += interval;
            }
            
            setTimeout(scheduleBeats, 25);
        }
        
        scheduleBeats();
    };

    CalibrationUI.prototype.scheduleMetronomeBeat = function(time) {
        var audioContext = this.audioManager.audioContext;
        
        try {
            var oscillator = audioContext.createOscillator();
            var gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, time);
            gainNode.gain.setValueAtTime(0.3, time);
            gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
            
            oscillator.start(time);
            oscillator.stop(time + 0.1);
        } catch (error) {
            console.error('메트로놈 비트 스케줄링 실패:', error);
        }
    };

    CalibrationUI.prototype.recordCalibrationHit = function() {
        var inputTime = this.audioManager.audioContext.currentTime;
        
        var closestBeat = null;
        var minDistance = Infinity;
        
        for (var i = 0; i < this.beatTimes.length; i++) {
            var beatTime = this.beatTimes[i];
            var distance = Math.abs(inputTime - beatTime);
            if (distance < minDistance && distance < 0.3) {
                minDistance = distance;
                closestBeat = beatTime;
            }
        }
        
        if (closestBeat) {
            if (this.audioManager.calibrator) {
                this.audioManager.calibrator.recordUserInput(inputTime, closestBeat);
            }
            
            this.calibrationCount++;
            
            var progressCount = document.getElementById('progress-count');
            if (progressCount) {
                progressCount.textContent = this.calibrationCount.toString();
            }
            
            if (this.calibrationCount >= this.targetCount) {
                this.finishCalibration();
            }
            
            debugLog('캘리브레이션 히트: ' + this.calibrationCount + '/' + this.targetCount);
        }
    };

    CalibrationUI.prototype.finishCalibration = function() {
        this.stopCalibration();
        
        var status = this.audioManager.calibrator ? this.audioManager.calibrator.getStatus() : null;
        
        if (status) {
            var message = '🎉 캘리브레이션 완료!\n\n' +
                          '평균 오프셋: ' + (status.calibrationOffset * 1000).toFixed(1) + 'ms\n' +
                          '총 보정값: ' + (status.totalOffset * 1000).toFixed(1) + 'ms';
            alert(message);
            debugLog('자동 캘리브레이션 완료', status);
        } else {
            alert('🎉 캘리브레이션 완료!');
        }
    };

    // =================================================================
    // 메인 오디오 매니저
    // =================================================================
    
    function CompatibleAudioManager() {
        this.audioContext = null;
        this.calibrator = new ImprovedCalibrator();
        this.calibrationUI = null;
        this.platformInfo = null;
        this.isInitialized = false;
        this.originalFunctions = {};
        this.currentAudioFileName = null;
        this.compatibilityMode = true;
        this.lastNoteHitTime = 0;
    }

    CompatibleAudioManager.prototype.init = function() {
        var self = this;
        
        return new Promise(function(resolve, reject) {
            if (self.isInitialized) {
                debugLog('이미 초기화됨');
                resolve(false);
                return;
            }

            try {
                debugLog('오디오 시스템 초기화 시작');
                
                self.platformInfo = detectPlatform();
                debugLog('플랫폼 감지', self.platformInfo);
                
                var settings = getOptimizedSettings(self.platformInfo.platform);
                var AudioContextClass = window.AudioContext || window.webkitAudioContext;
                
                self.audioContext = new AudioContextClass({
                    latencyHint: settings.latencyHint,
                    sampleRate: settings.sampleRate
                });
                
                debugLog('AudioContext 생성됨', {
                    state: self.audioContext.state,
                    sampleRate: self.audioContext.sampleRate,
                    baseLatency: self.audioContext.baseLatency
                });
                
                if (self.audioContext.state === 'suspended') {
                    self.audioContext.resume().then(function() {
                        self.completeInit(resolve);
                    }).catch(function(error) {
                        console.error('AudioContext resume 실패:', error);
                        self.completeInit(resolve);
                    });
                } else {
                    self.completeInit(resolve);
                }
                
            } catch (error) {
                console.error('오디오 시스템 초기화 실패:', error);
                resolve(false);
            }
        });
    };

    CompatibleAudioManager.prototype.completeInit = function(resolve) {
        try {
            this.calibrator.measureSystemLatency(this.audioContext);
            this.calibrator.setContext(this.platformInfo.platform, null);
            this.calibrationUI = new CalibrationUI(this);
            this.hookExistingFunctions();
            
            this.isInitialized = true;
            debugLog('오디오 시스템 초기화 완료');
            resolve(true);
        } catch (error) {
            console.error('초기화 완료 중 오류:', error);
            resolve(false);
        }
    };

    CompatibleAudioManager.prototype.hookExistingFunctions = function() {
        var self = this;
        
        if (window.checkNoteHits && typeof window.checkNoteHits === 'function') {
            this.originalFunctions.checkNoteHits = window.checkNoteHits;
            
            window.checkNoteHits = function(currentTime) {
                try {
                    if (self.isInitialized && self.compatibilityMode) {
                        return self.compatibleCheckNoteHits(currentTime);
                    } else {
                        return self.originalFunctions.checkNoteHits(currentTime);
                    }
                } catch (error) {
                    console.error('checkNoteHits 오류, 기존 함수로 폴백:', error);
                    return self.originalFunctions.checkNoteHits(currentTime);
                }
            };
            
            debugLog('checkNoteHits 함수 후킹 완료');
        }
        
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

    CompatibleAudioManager.prototype.compatibleCheckNoteHits = function(currentTime) {
        try {
            var notes = window.notes;
            var playedNotes = window.playedNotes;
            var playNoteSound = window.playNoteSound;
            var highlightNoteHit = window.highlightNoteHit;
            
            if (!notes || !playedNotes || !playNoteSound) {
                return this.originalFunctions.checkNoteHits(currentTime);
            }
            
            var bpmElement = document.getElementById("bpm");
            var subdivisionsElement = document.getElementById("subdivisions");
            
            if (!bpmElement || !subdivisionsElement) {
                return this.originalFunctions.checkNoteHits(currentTime);
            }
            
            var bpm = parseFloat(bpmElement.value || 120);
            var subdivisions = parseInt(subdivisionsElement.value || 16);
            var tolerance = 0.05;

            for (var i = 0; i < notes.length; i++) {
                var note = notes[i];
                var noteId = note.type + '-' + note.beat + '-' + i;

                if (playedNotes.has(noteId)) continue;

                var targetTime;
                
                if (note.beat === 0 && note.type === "direction") {
                    targetTime = 0;
                } else {
                    var originalTime = window.beatToTime(note.beat, bpm, subdivisions);
                    var preDelaySeconds = window.getPreDelaySeconds();
                    var baseTime = originalTime + preDelaySeconds;
                    
                    if (this.compatibilityMode && this.calibrator) {
                        targetTime = this.calibrator.getAdjustedTiming(baseTime);
                    } else {
                        targetTime = baseTime;
                    }
                }

                if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
                    if (Math.abs(currentTime - this.lastNoteHitTime) < 0.01) {
                        continue;
                    }
                    
                    if (!(note.beat === 0 && note.type === "direction")) {
                        try {
                            playNoteSound(note.type);
                        } catch (soundError) {
                            console.error('효과음 재생 실패:', soundError);
                        }
                    }
                    
                    playedNotes.add(noteId);
                    
                    if (highlightNoteHit) {
                        try {
                            highlightNoteHit(i);
                        } catch (highlightError) {
                            console.error('하이라이트 실패:', highlightError);
                        }
                    }
                    
                    this.lastNoteHitTime = currentTime;
                    
                    console.log('🎵 개선된 노트 히트: ' + note.type + ' beat ' + note.beat + ', 시간 ' + targetTime.toFixed(3) + 's');
                }
            }
            
        } catch (error) {
            console.error('compatibleCheckNoteHits 오류:', error);
            return this.originalFunctions.checkNoteHits(currentTime);
        }
    };

    // 필수 메서드들 추가
    CompatibleAudioManager.prototype.getStatus = function() {
        if (!this.isInitialized) return null;
        
        return {
            platform: this.platformInfo,
            audioContext: {
                state: this.audioContext.state,
                sampleRate: this.audioContext.sampleRate,
                baseLatency: this.audioContext.baseLatency,
                outputLatency: this.audioContext.outputLatency
            },
            calibration: this.calibrator.getStatus(),
            isInitialized: this.isInitialized,
            compatibilityMode: this.compatibilityMode
        };
    };

    CompatibleAudioManager.prototype.showCalibrationUI = function() {
        if (this.calibrationUI) {
            this.calibrationUI.show();
        }
    };

    CompatibleAudioManager.prototype.checkSoundSystem = function() {
        var report = {
            tabSoundPool: {
                exists: !!(window.tabSoundPool),
                count: window.tabSoundPool ? window.tabSoundPool.length : 0
            },
            directionSoundPool: {
                exists: !!(window.directionSoundPool),
                count: window.directionSoundPool ? window.directionSoundPool.length : 0
            },
            playNoteSound: {
                exists: typeof window.playNoteSound === 'function'
            }
        };
        
        console.log('🔊 사운드 시스템 상태:', report);
        return report;
    };

    CompatibleAudioManager.prototype.testSound = function() {
        if (typeof window.playNoteSound === 'function') {
            try {
                console.log('🧪 Tab 사운드 테스트...');
                window.playNoteSound('tab');
                
                setTimeout(function() {
                    console.log('🧪 Direction 사운드 테스트...');
                    window.playNoteSound('direction');
                }, 500);
            } catch (error) {
                console.error('사운드 테스트 실패:', error);
            }
        } else {
            console.error('playNoteSound 함수가 없습니다.');
        }
    };

    CompatibleAudioManager.prototype.toggleCompatibilityMode = function() {
        this.compatibilityMode = !this.compatibilityMode;
        console.log('🔄 호환성 모드 ' + (this.compatibilityMode ? '활성화' : '비활성화'));
        return this.compatibilityMode;
    };

    CompatibleAudioManager.prototype.revertToOriginal = function() {
        if (this.originalFunctions.checkNoteHits) {
            window.checkNoteHits = this.originalFunctions.checkNoteHits;
            console.log('🔙 기존 checkNoteHits 함수로 복원됨');
        }
    };

    CompatibleAudioManager.prototype.destroy = function() {
        if (!this.isInitialized) return;
        
        this.revertToOriginal();
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        var panel = document.getElementById('audio-sync-panel');
        if (panel) panel.remove();
        
        this.isInitialized = false;
        debugLog('오디오 시스템 정리 완료');
    };

    // =================================================================
    // 공개 API
    // =================================================================
    
    var audioManager = null;

    window.AudioSyncModule = {
        init: function() {
            if (audioManager) {
                debugLog('이미 초기화된 오디오 매니저가 있습니다.');
                return Promise.resolve(false);
            }
            
            audioManager = new CompatibleAudioManager();
            return audioManager.init().then(function(success) {
                if (success) {
                    window.improvedAudioManager = audioManager;
                    window.AudioSyncModule.addCalibrationButton();
                }
                return success;
            });
        },

        showCalibration: function() {
            if (audioManager && audioManager.showCalibrationUI) {
                audioManager.showCalibrationUI();
            } else {
                alert('오디오 매니저가 초기화되지 않았습니다.');
            }
        },

        getStatus: function() {
            return audioManager ? audioManager.getStatus() : null;
        },

        checkSoundSystem: function() {
            if (audioManager && audioManager.checkSoundSystem) {
                return audioManager.checkSoundSystem();
            } else {
                console.log('오디오 매니저가 초기화되지 않았습니다.');
                return null;
            }
        },

        testSound: function() {
            if (audioManager && audioManager.testSound) {
                audioManager.testSound();
            } else {
                console.log('오디오 매니저가 초기화되지 않았습니다.');
            }
        },

        toggleCompatibilityMode: function() {
            if (audioManager && audioManager.toggleCompatibilityMode) {
                return audioManager.toggleCompatibilityMode();
            } else {
                console.log('오디오 매니저가 초기화되지 않았습니다.');
                return false;
            }
        },

        revertToOriginal: function() {
            if (audioManager && audioManager.revertToOriginal) {
                audioManager.revertToOriginal();
                console.log('✅ 기존 오디오 시스템으로 복원됨');
            } else {
                console.log('복원할 오디오 매니저가 없습니다.');
            }
        },

        destroy: function() {
            if (audioManager) {
                audioManager.destroy();
                audioManager = null;
                window.improvedAudioManager = null;
                console.log('🧹 오디오 시스템 정리 완료');
            }
        },

        addCalibrationButton: function() {
            var topBar = document.getElementById('top-bar');
            if (!topBar) return;
            
            var existingCalibration = document.getElementById('audio-calibration-btn');
            var existingDebug = document.getElementById('audio-debug-btn');
            
            if (existingCalibration) existingCalibration.remove();
            if (existingDebug) existingDebug.remove();
            
            // 캘리브레이션 버튼
            var calibrationButton = document.createElement('button');
            calibrationButton.id = 'audio-calibration-btn';
            calibrationButton.innerHTML = '🎵 오디오 캘리브레이션';
            calibrationButton.style.cssText = [
                'background: linear-gradient(135deg, #4CAF50, #45a049) !important',
                'color: white !important',
                'border: 1px solid #45a049 !important',
                'font-weight: bold !important',
                'margin-left: 8px; padding: 8px 16px; border-radius: 6px',
                'cursor: pointer; transition: all 0.2s ease'
            ].join('; ');
            
            calibrationButton.addEventListener('click', function() {
                window.AudioSyncModule.showCalibration();
            });
            
            // 디버그 버튼
            var debugButton = document.createElement('button');
            debugButton.id = 'audio-debug-btn';
            debugButton.innerHTML = '🔧 오디오 디버그';
            debugButton.style.cssText = [
                'background: linear-gradient(135deg, #FF9800, #F57C00) !important',
                'color: white !important',
                'border: 1px solid #F57C00 !important',
                'font-weight: bold !important',
                'margin-left: 8px; padding: 8px 16px; border-radius: 6px',
                'cursor: pointer; transition: all 0.2s ease; font-size: 12px'
            ].join('; ');
            
            debugButton.addEventListener('click', function() {
                window.AudioSyncModule.showDebugMenu();
            });
            
            topBar.appendChild(calibrationButton);
            topBar.appendChild(debugButton);
            
            debugLog('캘리브레이션 버튼과 디버그 버튼 추가됨');
        },

        showDebugMenu: function() {
            var debugMenuHtml = [
                '<div id="debug-menu" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10001;',
                'background: rgba(20, 20, 20, 0.95); padding: 20px; border-radius: 12px; border: 2px solid #FF9800;',
                'box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6); min-width: 300px; color: #fff;">',
                
                '<h3 style="margin: 0 0 15px 0; color: #FF9800; text-align: center;">🔧 오디오 디버그 메뉴</h3>',
                
                '<div style="margin-bottom: 15px;">',
                '<button onclick="AudioSyncModule.checkSoundSystem()" style="width: 100%; padding: 10px; margin-bottom: 8px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">사운드 시스템 상태 확인</button>',
                '<button onclick="AudioSyncModule.testSound()" style="width: 100%; padding: 10px; margin-bottom: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">효과음 테스트</button>',
                '<button onclick="AudioSyncModule.toggleCompatibilityMode()" style="width: 100%; padding: 10px; margin-bottom: 8px; background: #9C27B0; color: white; border: none; border-radius: 4px; cursor: pointer;">호환성 모드 토글</button>',
                '<button onclick="AudioSyncModule.revertToOriginal()" style="width: 100%; padding: 10px; margin-bottom: 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">기존 시스템으로 복원</button>',
                '<button onclick="AudioSyncModule.logStatus()" style="width: 100%; padding: 10px; background: #607D8B; color: white; border: none; border-radius: 4px; cursor: pointer;">전체 상태 로그</button>',
                '</div>',
                
                '<div style="text-align: center;">',
                '<button onclick="document.getElementById(\'debug-menu\').remove()" style="padding: 8px 20px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">닫기</button>',
                '</div></div>'
            ].join('');
            
            var existingMenu = document.getElementById('debug-menu');
            if (existingMenu) existingMenu.remove();
            
            document.body.insertAdjacentHTML('beforeend', debugMenuHtml);
        },

        logStatus: function() {
            console.log('=== 완전한 오디오 시스템 상태 ===');
            console.log('초기화 상태:', !!audioManager);
            if (audioManager) {
                var status = audioManager.getStatus();
                console.log('전체 상태:', status);
            }
            this.checkSoundSystem();
        }
    };

    // 전역 접근을 위한 디버깅 함수들
    window.audioManager = audioManager; // 임시 전역 접근 (디버깅용)

    console.log('🎯 완전한 오디오 동기화 모듈 로드 완료!');
    console.log('사용법: AudioSyncModule.init() → 캘리브레이션 버튼 클릭');

})();