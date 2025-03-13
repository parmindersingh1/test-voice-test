'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

// Mock responses for demonstration
const mockResponses = [
  "Hello! How can I help you today?",
  "That's an interesting question. Let me think about it.",
  "I understand what you're asking. Here's what I think.",
  "Thanks for sharing that with me. Would you like to know more?",
  "I appreciate your question. Let me explain.",
];

export default function Home() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const { toast } = useToast();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const silenceDetectorRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpeechRef = useRef<number>(Date.now());
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const recordingStartTimeRef = useRef<number>(0);
  const minChunkDurationMs = 2000; // Minimum chunk duration in milliseconds

  const getMockResponse = () => {
    return mockResponses[Math.floor(Math.random() * mockResponses.length)];
  };

  useEffect(() => {
    // Clean up when component unmounts
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
      }

      if (silenceDetectorRef.current) {
        clearInterval(silenceDetectorRef.current);
      }
    };
  }, []);

  const handleSpeechError = (error: string) => {
    setIsListening(false);
    let message = '';

    switch (error) {
      case 'no-speech':
        message = 'No speech was detected. Please try again.';
        break;
      case 'aborted':
        message = 'Listening was stopped.';
        break;
      case 'network':
        message = 'Please check your internet connection.';
        break;
      case 'not-allowed':
        message = 'Microphone permission is required.';
        break;
      case 'language-not-supported':
        message = 'The language is not supported. Please try a different language.';
        break;
      default:
        message = 'An error occurred. Please try again.';
    }

    toast({
      title: 'Voice Recognition',
      description: message,
      variant: 'destructive',
    });
  };

  // Function to convert audio buffer to WAV format
  const bufferToWav = (buffer: AudioBuffer, sampleRate: number) => {
    const numOfChannels = buffer.numberOfChannels;
    const length = buffer.length * numOfChannels * 2; // 2 bytes per sample (16-bit)
    const audioData = new ArrayBuffer(44 + length);
    const view = new DataView(audioData);
    
    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + length, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, numOfChannels, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * numOfChannels * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, numOfChannels * 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, length, true);
    
    // Write the PCM samples
    const channelData = [];
    let offset = 44;
    
    for (let i = 0; i < numOfChannels; i++) {
      channelData.push(buffer.getChannelData(i));
    }
    
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numOfChannels; channel++) {
        // Convert float to int16
        const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
        const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, value, true);
        offset += 2;
      }
    }
    
    return new Blob([audioData], { type: 'audio/wav' });
  };
  
  // Helper function to write strings to DataView
  const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const startTimer = () => {
    setElapsedTime(0);
    timerRef.current = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  };

  // Start a new recording chunk
  const startNewChunk = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
    
    // Process existing chunks if there are any
    if (audioChunksRef.current.length > 0) {
      processAudioChunks();
    }
    
    // Reset recording start time
    recordingStartTimeRef.current = Date.now();
    
    // Stop current recording and start a new one
    mediaRecorderRef.current.stop();
    
    // Small delay to ensure proper stop/start sequence
    setTimeout(() => {
      if (streamRef.current && isListening) {
        try {
          const options = { mimeType: 'audio/webm' };
          const recorder = new MediaRecorder(streamRef.current, options);
          mediaRecorderRef.current = recorder;
          
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              audioChunksRef.current.push(e.data);
            }
          };
          
          recorder.start(100);
        } catch (err) {
          console.error('Error restarting recorder:', err);
        }
      }
    }, 100);
  };

  // Process audio chunks and convert to WAV
  const processAudioChunks = async () => {
    if (isProcessingRef.current || audioChunksRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = []; // Reset for next chunk
      
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext();
      
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const wavBlob = bufferToWav(audioBuffer, audioContext.sampleRate);
      const url = URL.createObjectURL(wavBlob);
      
      setAudioUrls(prevUrls => [...prevUrls, url]);
      
      audioContext.close();
      
      // Notify user about new chunk
      toast({
        title: 'New Audio Chunk',
        description: `Chunk #${audioUrls.length + 1} processed`,
      });
    } catch (err) {
      console.error('Error processing audio chunk:', err);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const startListening = () => {
    // If already listening, stop the recognition
    if (isListening) {
      window.speechSynthesis.cancel();
      setIsListening(false);
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      stopTimer();
      
      // Stop media recorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      // Stop microphone stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      // Clear intervals
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
      }
      
      if (silenceDetectorRef.current) {
        clearInterval(silenceDetectorRef.current);
      }
      
      return;
    }

    // Add interruption handling
    const handleInterruption = () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setResponse('');
        toast({
          title: 'Interrupted',
          description: 'Assistant stopped speaking',
        });
      }
    };

    if ('webkitSpeechRecognition' in window) {
      const recognition = new (window as any).webkitSpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-IN';

      // Reset audio data
      audioChunksRef.current = [];
      setAudioUrls([]);

      // Setup audio recording with WAV format
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          streamRef.current = stream;
          recordingStartTimeRef.current = Date.now();
          
          try {
            // Initialize audio context
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            
            // Create analyser node
            const analyser = audioContext.createAnalyser();
            analyserRef.current = analyser;
            analyser.fftSize = 32;
            
            // Create media stream source
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            
            // Start animation frame for visualization
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateAudioLevel = () => {
              if (isListening) {
                analyser.getByteFrequencyData(dataArray);
                const level = Math.max(...dataArray) / 255;
                setAudioLevel(level);
                requestAnimationFrame(updateAudioLevel);
              }
            };
            updateAudioLevel();
            
            // Create media recorder
            const options = { mimeType: 'audio/webm' };
            const recorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = recorder;
            
            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) {
                audioChunksRef.current.push(e.data);
              }
            };
            
            // Start recorder
            recorder.start(100);
            
            // Set up silence detection to create new chunks
            lastSpeechRef.current = Date.now();
            
            silenceDetectorRef.current = setInterval(() => {
              analyser.getByteFrequencyData(dataArray);
              const level = Math.max(...dataArray) / 255;
              
              // If audio level is above threshold, update last speech time
              if (level > 0.05) {
                lastSpeechRef.current = Date.now();
              } else {
                // If silent for more than 1 second, process the current chunk
                const silenceDuration = Date.now() - lastSpeechRef.current;
                const chunkDuration = Date.now() - recordingStartTimeRef.current;
                
                if (silenceDuration > 1000 && chunkDuration > minChunkDurationMs && audioChunksRef.current.length > 0) {
                  processAudioChunks();
                  // Start a new recording immediately
                  if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                    mediaRecorderRef.current.stop();
                    setTimeout(() => {
                      if (streamRef.current && isListening) {
                        const options = { mimeType: 'audio/webm' };
                        const recorder = new MediaRecorder(streamRef.current, options);
                        mediaRecorderRef.current = recorder;
                        recorder.ondataavailable = (e) => {
                          if (e.data.size > 0) {
                            audioChunksRef.current.push(e.data);
                          }
                        };
                        recorder.start(100);
                        recordingStartTimeRef.current = Date.now();
                      }
                    }, 100);
                  }
                }
              }
            }, 200);
            
          } catch (error) {
            console.error('Error setting up audio recording:', error);
            toast({
              title: 'Error',
              description: 'Could not set up audio recording',
              variant: 'destructive',
            });
          }
        })
        .catch((error) => {
          console.error('Error accessing microphone:', error);
          toast({
            title: 'Error',
            description: 'Could not access microphone',
            variant: 'destructive',
          });
        });

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript('');
        setResponse('');
        startTimer();
        toast({
          title: 'Listening',
          description: 'Speak now...',
        });
      };

      recognition.onresult = (event: any) => {
        // Handle interruption if assistant is speaking
        if (window.speechSynthesis.speaking) {
          handleInterruption();
        }

        const userText = event.results[event.results.length - 1][0].transcript;
        setTranscript(userText);

        // Update last speech time when there's a result
        lastSpeechRef.current = Date.now();

        // Get and speak mock response only when speech is final
        if (event.results[event.results.length - 1].isFinal) {
          const mockResponse = getMockResponse();
          setResponse(mockResponse);
          
          // Process current audio chunk when utterance is complete
          const chunkDuration = Date.now() - recordingStartTimeRef.current;
          if (chunkDuration > minChunkDurationMs && audioChunksRef.current.length > 0) {
            startNewChunk();
          }

          window.speechSynthesis.cancel();
          const speech = new SpeechSynthesisUtterance(mockResponse);

          // Get available voices and filter for Indian ones
          const voices = window.speechSynthesis.getVoices();
          const indianVoices = voices.filter(voice => voice.lang === 'en-IN');

          // Use an Indian voice if available, otherwise fallback to default
          if (indianVoices.length > 0) {
            // Alternate between male and female voices if both are available
            const maleVoice = indianVoices.find(voice => voice.name.includes('Male'));
            const femaleVoice = indianVoices.find(voice => voice.name.includes('Female'));
            
            if (maleVoice && femaleVoice) {
              // Alternate between male and female voices for each response
              speech.voice = Math.random() > 0.5 ? maleVoice : femaleVoice;
            } else {
              // Use whatever Indian voice is available
              speech.voice = indianVoices[0];
            }
          } else {
            // Fallback to default voice if no Indian voices are found
            speech.voice = voices.find(voice => voice.default) || voices[0];
          }

          speech.lang = 'en-IN'; // Set to Indian English
          speech.rate = 1;
          speech.pitch = 1;
          window.speechSynthesis.speak(speech);
        }
      };

      recognition.onerror = (event: any) => {
        handleSpeechError(event.error);
      };

      recognition.onend = () => {
        // Only stop if not manually stopped
        if (isListening) {
          setIsListening(false);
          stopTimer();
          
          // Process any remaining audio
          if (audioChunksRef.current.length > 0) {
            processAudioChunks();
          }
          
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
          
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
          }
          
          if (chunkIntervalRef.current) {
            clearInterval(chunkIntervalRef.current);
          }
          
          if (silenceDetectorRef.current) {
            clearInterval(silenceDetectorRef.current);
          }

          toast({
            title: 'Stopped',
            description: 'Speech recognition has stopped.',
          });
        }
      };

      try {
        recognition.start();
      } catch (error) {
        handleSpeechError('not-allowed');
      }
    } else {
      toast({
        title: 'Not Supported',
        description: 'Speech recognition is not supported in your browser.',
        variant: 'destructive',
      });
    }
  };

  const handleDownload = (url: string, index: number) => {
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.download = `recording-chunk-${index}-${new Date().toISOString()}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: 'Success',
        description: `Audio chunk ${index + 1} downloaded as WAV`,
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 flex items-center justify-center">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card className="w-full p-0 overflow-hidden shadow-lg border border-gray-200/50 dark:border-gray-700/50">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 p-8">
            <div className="text-center space-y-3">
              <CardTitle className="text-3xl font-bold text-white drop-shadow-md">Voice Assistant</CardTitle>
              <CardDescription className="text-gray-200/90 text-sm">
                {isListening ? (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  >
                    Listening... Speak now
                  </motion.span>
                ) : (
                  'Click to start your voice interaction'
                )}
              </CardDescription>
            </div>
          </CardHeader>

          <div className="p-8 space-y-8">
            <div className="flex flex-col items-center gap-6">
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="relative"
              >
                <Button
                  size="lg"
                  className={`w-24 h-24 rounded-full transition-all duration-300 relative overflow-hidden ${
                    isListening 
                      ? 'bg-red-500 hover:bg-red-600 shadow-lg scale-110 ring-4 ring-red-500/30' 
                      : 'bg-blue-600 hover:bg-blue-700 ring-4 ring-blue-600/30'
                  }`}
                  onClick={startListening}
                >
                  {isListening && (
                    <motion.div 
                      className="absolute inset-0 animate-spark"
                      style={{
                        background: `radial-gradient(circle at center, rgba(255,255,255,0.8) 0%, transparent 70%)`,
                        transform: `scale(${1 + audioLevel * 0.5})`,
                        opacity: audioLevel,
                      }}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                  {isListening ? (
                    <MicOff className="w-10 h-10 text-white relative z-10" />
                  ) : (
                    <Mic className="w-10 h-10 text-white relative z-10" />
                  )}
                </Button>
              </motion.div>
              
              {isListening && (
                <div className="w-full space-y-3">
                  <div className="text-center text-sm text-gray-600 dark:text-gray-300 font-medium">
                    Elapsed Time: {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
                  </div>
                  <motion.div 
                    className="w-full h-3 bg-gray-200/50 dark:bg-gray-700/50 rounded-full overflow-hidden"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-50"
                      style={{ width: `${audioLevel * 100}%` }}
                    />
                  </motion.div>
                </div>
              )}
              
              <AnimatePresence>
                {transcript && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="w-full p-5 bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-lg border border-gray-200/50 dark:border-gray-700/50"
                  >
                    <p className="font-medium text-gray-600 dark:text-gray-300">You said:</p>
                    <p className="text-sm text-gray-800 dark:text-gray-100 mt-1.5 leading-relaxed">{transcript}</p>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <AnimatePresence>
                {response && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="w-full p-5 bg-blue-50/80 dark:bg-blue-900/20 backdrop-blur-sm rounded-lg border border-blue-200/50 dark:border-blue-800/50"
                  >
                    <p className="font-medium text-blue-600 dark:text-blue-300">Assistant:</p>
                    <p className="text-sm text-blue-800 dark:text-blue-100 mt-1.5 leading-relaxed">{response}</p>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <AnimatePresence>
                {audioUrls.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="w-full p-5 bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-lg border border-gray-200/50 dark:border-gray-700/50"
                  >
                    <p className="font-medium text-gray-600 dark:text-gray-300 mb-3">Recorded Audio Chunks:</p>
                    <div className="space-y-4">
                      {audioUrls.map((url, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg">
                          <span className="text-sm font-medium">Chunk {index + 1}</span>
                          <audio controls src={url} className="flex-1" />
                          <motion.button 
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => handleDownload(url, index)}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                            title="Download audio chunk"
                          >
                            <svg 
                              xmlns="http://www.w3.org/2000/svg" 
                              width="24" 
                              height="24" 
                              viewBox="0 0 24 24" 
                              fill="none" 
                              stroke="currentColor" 
                              strokeWidth="2" 
                              strokeLinecap="round" 
                              strokeLinejoin="round"
                              className="w-5 h-5 text-gray-600 dark:text-gray-300"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          </motion.button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}