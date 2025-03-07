'use client';

import { useState } from 'react';
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

  const getMockResponse = () => {
    return mockResponses[Math.floor(Math.random() * mockResponses.length)];
  };

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
    console.log("err", error)

    toast({
      title: 'Voice Recognition',
      description: message,
      variant: 'destructive',
    });
  };

  const startListening = () => {
    // If already listening, stop the recognition
    if (isListening) {
      window.speechSynthesis.cancel();
      setIsListening(false);
      return;
    }

    if ('webkitSpeechRecognition' in window) {
      const recognition = new (window as any).webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-IN';

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
        const userText = event.results[0][0].transcript;
        setTranscript(userText);
        
        // Get and speak mock response
        const mockResponse = getMockResponse();
        setResponse(mockResponse);
        
        // Cancel any ongoing speech before starting new one
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
        </div>
      </Card>
    </div>
  );
}