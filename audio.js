// 오디오 관련 함수들

// 사운드 풀 관리
export class SoundPool {
    constructor(audioSrc, poolSize = 10) {
        this.sounds = [];
        this.currentIndex = 0;
        this.poolSize = poolSize;
        this.init(audioSrc);
    }

    init(audioSrc) {
        for (let i = 0; i < this.poolSize; i++) {
            const audio = new Audio(audioSrc);
            audio.preload = 'auto';
            this.sounds.push(audio);
        }
    }

    play(volume = 1.0) {
        const sound = this.sounds[this.currentIndex];
        sound.volume = volume;
        sound.currentTime = 0;
        sound.play().catch(e => console.log('Audio play failed:', e));
        this.currentIndex = (this.currentIndex + 1) % this.poolSize;
    }

    setVolume(volume) {
        this.sounds.forEach(sound => {
            sound.volume = volume;
        });
    }
}

// 오디오 파일 로드
export function loadAudioFile(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.decodeAudioData(e.target.result)
            .then(buffer => callback(buffer))
            .catch(err => console.error('Audio decode failed:', err));
    };
    reader.readAsArrayBuffer(file);
}

// 오디오 시간을 픽셀 위치로 변환
export function timeToPixels(time, duration, containerWidth) {
    return (time / duration) * containerWidth;
}

// 픽셀 위치를 오디오 시간으로 변환
export function pixelsToTime(pixels, duration, containerWidth) {
    return (pixels / containerWidth) * duration;
}

// 오디오 볼륨 설정
export function setAudioVolume(audioElement, volume) {
    if (audioElement) {
        audioElement.volume = Math.max(0, Math.min(1, volume));
    }
}

// 오디오 재생 상태 확인
export function isAudioPlaying(audioElement) {
    return audioElement && !audioElement.paused && !audioElement.ended;
}

// 오디오 시간 포맷팅 (MM:SS.ms)
export function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

// Web Audio API를 사용한 오디오 분석
export function createAudioAnalyzer(audioElement) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaElementSource(audioElement);
    
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    return {
        analyser,
        dataArray,
        getFrequencyData: () => {
            analyser.getByteFrequencyData(dataArray);
            return dataArray;
        }
    };
}