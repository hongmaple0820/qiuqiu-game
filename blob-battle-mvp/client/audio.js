// 音效系统 - Web Audio API
const AudioSystem = {
    audioContext: null,
    sounds: {},
    masterVolume: 0.5,
    initialized: false,

    async init() {
        if (this.initialized) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await this.generateSounds();
            this.initialized = true;
            console.log('✅ 音效系统已初始化');
        } catch (e) {
            console.warn('⚠️ 音效系统初始化失败:', e);
        }
    },

    // 创建简单音调
    createTone(frequency, duration, type = 'sine', volume = 0.5) {
        return () => {
            if (!this.audioContext) return;
            
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            
            osc.type = type;
            osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            
            gain.gain.setValueAtTime(volume * this.masterVolume, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
            
            osc.connect(gain);
            gain.connect(this.audioContext.destination);
            
            osc.start();
            osc.stop(this.audioContext.currentTime + duration);
        };
    },

    // 生成程序化音效
    async generateSounds() {
        this.sounds.eat = this.createTone(800, 0.1, 'sine', 0.3);
        this.sounds.split = this.createTone(200, 0.3, 'square', 0.4);
        this.sounds.eject = this.createTone(600, 0.15, 'triangle', 0.25);
        this.sounds.powerup = this.createRisingTone(400, 800, 0.4);
        this.sounds.levelup = this.createCelebration();
    },

    // 创建上升音调
    createRisingTone(startFreq, endFreq, duration) {
        return () => {
            if (!this.audioContext) return;
            
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(startFreq, this.audioContext.currentTime);
            osc.frequency.linearRampToValueAtTime(endFreq, this.audioContext.currentTime + duration);
            
            gain.gain.setValueAtTime(0.5 * this.masterVolume, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
            
            osc.connect(gain);
            gain.connect(this.audioContext.destination);
            
            osc.start();
            osc.stop(this.audioContext.currentTime + duration);
        };
    },

    // 创建庆祝音效
    createCelebration() {
        return () => {
            if (!this.audioContext) return;
            
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, i) => {
                setTimeout(() => {
                    const osc = this.audioContext.createOscillator();
                    const gain = this.audioContext.createGain();
                    
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    
                    gain.gain.setValueAtTime(0.3 * this.masterVolume, this.audioContext.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
                    
                    osc.connect(gain);
                    gain.connect(this.audioContext.destination);
                    
                    osc.start();
                    osc.stop(this.audioContext.currentTime + 0.3);
                }, i * 100);
            });
        };
    },

    // 播放音效
    play(soundName) {
        if (!this.initialized) {
            this.init().then(() => {
                if (this.sounds[soundName]) {
                    this.sounds[soundName]();
                }
            });
        } else {
            if (this.sounds[soundName]) {
                this.sounds[soundName]();
            }
        }
    }
};
