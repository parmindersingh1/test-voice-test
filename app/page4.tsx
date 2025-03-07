'use client';
import 'regenerator-runtime/runtime';

import { useState, useEffect } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
// import styles from '../styles/Home.module.css';

export default function Home() {
  const [messages, setMessages] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition
  } = useSpeechRecognition();

  // Mock responses
  const mockResponses = [
    "That's interesting! Tell me more.",
    "Cool, what else you got?",
    "Nice one! What's next?",
    "I hear you, anything else on your mind?"
  ];

  useEffect(() => {
    if (!listening && transcript) {
      // Add user message
      setMessages(prev => [...prev, `You: ${transcript}`]);
      
      // Generate mock response
      const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
      setTimeout(() => {
        setMessages(prev => [...prev, `Bot: ${randomResponse}`]);
      }, 1000);
      
      resetTranscript();
    }
  }, [listening, transcript]);

  const toggleListening = () => {
    if (isListening) {
      SpeechRecognition.stopListening();
    } else {
      SpeechRecognition.startListening({ continuous: true });
    }
    setIsListening(!isListening);
  };

  if (!browserSupportsSpeechRecognition) {
    return <div>Your browser doesn&apos;t support speech recognition.</div>;
  }

  return (
    <div >
      <h1>Voice Chat App</h1>
      
      <div >
        {messages.map((msg, index) => (
          <div key={index} >
            {msg}
          </div>
        ))}
      </div>

      <div >
        <button 
          onClick={toggleListening}
          className='button'
        //   className={`${isListening ? styles.listening : ''}`}
        >
          {isListening ? 'Stop Listening' : 'Start Listening'}
        </button>
        <p>Microphone: {listening ? 'ON' : 'OFF'}</p>
      </div>

      {transcript && (
        <div >
          Current transcript: {transcript}
        </div>
      )}
    </div>
  );
}