'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  const startListening = () => {
    // If already listening, stop the recognition
    if (isListening) {
      window.speechSynthesis.cancel();
      setIsListening(false);
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    if ('webkitSpeechRecognition' in window) {
      const recognition = new (window as any).webkitSpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-IN';

      // Reset audio data
      audioChunksRef.current = [];
      setAudioUrl(null);

      // Setup audio recording with WAV format
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          streamRef.current = stream;
          
          try {
            // Initialize audio context
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            
            // Create media recorder for raw PCM data
            const options = { mimeType: 'audio/webm' }; // Still using webm for recording
            const recorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = recorder;
            
            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) {
                audioChunksRef.current.push(e.data);
                console.log('Audio chunk added, total chunks:', audioChunksRef.current.length);
              }
            };
            
            recorder.onstop = async () => {
              console.log('MediaRecorder stopped, chunks:', audioChunksRef.current.length);
              // Create audio blob from recorded chunks
              if (audioChunksRef.current.length > 0) {
                // First create a blob with the recorded data (in WebM format)
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                
                // Convert WebM to WAV format
                const arrayBuffer = await audioBlob.arrayBuffer();
                const audioContext = new AudioContext();
                
                audioContext.decodeAudioData(arrayBuffer).then(audioBuffer => {
                  // Convert to WAV
                  const wavBlob = bufferToWav(audioBuffer, audioContext.sampleRate);
                  const url = URL.createObjectURL(wavBlob);
                  setAudioUrl(url);
                  console.log('WAV Audio URL created:', url);
                  
                  // Close the temporary audio context
                  audioContext.close();
                }).catch(err => {
                  console.error('Error decoding audio data:', err);
                  toast({
                    title: 'Error',
                    description: 'Failed to convert audio format',
                    variant: 'destructive',
                  });
                });
              } else {
                console.warn('No audio chunks available when recorder stopped');
              }
            };
            
            recorder.start(100); // Collect data every 100ms
            console.log('MediaRecorder started');
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
        toast({
          title: 'Listening',
          description: 'Speak now...',
        });
      };

      recognition.onresult = (event: any) => {
        const userText = event.results[event.results.length - 1][0].transcript;
        setTranscript(userText);

        // Reset silence timeout whenever speech is detected
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        silenceTimeoutRef.current = setTimeout(() => {
          recognition.stop();
        }, 2000); // 2 seconds of silence

        // Get and speak mock response
        const mockResponse = getMockResponse();
        setResponse(mockResponse);

        window.speechSynthesis.cancel();
        const speech = new SpeechSynthesisUtterance(mockResponse);
        speech.lang = 'en-US';
        speech.rate = 1;
        speech.pitch = 1;
        window.speechSynthesis.speak(speech);
      };

      recognition.onerror = (event: any) => {
        handleSpeechError(event.error);
      };

      recognition.onend = () => {
        setIsListening(false);
        
        // Stop media recorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        
        // Stop microphone stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        toast({
          title: 'Stopped',
          description: 'Speech recognition has stopped.',
        });
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

  const handleDownload = () => {
    if (audioUrl) {
      const link = document.createElement('a');
      link.href = audioUrl;
      link.download = `recording-${new Date().toISOString()}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: 'Success',
        description: 'Audio downloaded as WAV format',
      });
    } else {
      toast({
        title: 'Error',
        description: 'No audio recorded. Please try speaking again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 flex items-center justify-center">
      <Card className="w-full max-w-md p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Voice Assistant</h1>
          <p className="text-sm text-muted-foreground">
            {isListening ? 'Listening... Speak now' : 'Click the microphone to start'}
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <Button
            size="lg"
            className={`w-16 h-16 rounded-full transition-colors duration-200 ${
              isListening ? 'bg-red-500 hover:bg-red-600' : ''
            }`}
            onClick={startListening}
          >
            {isListening ? (
              <MicOff className="w-6 h-6" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </Button>
          
          {transcript && (
            <div className="w-full p-4 bg-muted rounded-lg">
              <p className="font-medium">You said:</p>
              <p className="text-sm">{transcript}</p>
            </div>
          )}
          
          {response && (
            <div className="w-full p-4 bg-primary/10 rounded-lg">
              <p className="font-medium">Assistant:</p>
              <p className="text-sm">{response}</p>
            </div>
          )}
          
          {audioUrl && (
            <div className="w-full p-4 bg-muted rounded-lg">
              <p className="font-medium mb-2">Recorded Audio (WAV):</p>
              <audio controls src={audioUrl} className="w-full mb-2" />
              <Button 
                onClick={handleDownload}
                className="w-full"
                variant="outline"
              >
                Download WAV Audio
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
  
}