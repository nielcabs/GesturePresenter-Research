import React, { useState, useEffect, useRef } from 'react';
import axios from "axios";
import { Hands, HAND_CONNECTIONS, Results, VERSION } from '@mediapipe/hands';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { getGesture } from './utils/GestureDetection'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate, faGear } from '@fortawesome/free-solid-svg-icons';
import './App.css';


interface CameraProps {
  pairingCode: string;
  flipped: boolean;
  onSettingsClick: () => void;
  modalVisible: boolean;
}

const Camera: React.FC<CameraProps> = ({ pairingCode, flipped, onSettingsClick, modalVisible }) => {
  const [isUserFacing, setIsUserFacing] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<Hands | null>(null);
  const isSendingRef = useRef(false);
  const intervalIdRef = useRef<number | undefined>(undefined);
  const [gestureResult, setGestureResult] = useState(0);

  useEffect(() => {
    if (intervalIdRef.current !== undefined) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = undefined;
    }

    const handleGestureStable = () => {
      if (gestureResult !== 0 && pairingCode !== '' && !modalVisible) {
        let gestureValue = gestureResult === 1 ? 'Right' : 'Left';
        const url = 'https://gesture-presenter-bc9d819e6d43.herokuapp.com/send_gesture';
        axios.post(url, {
          code: pairingCode,
          gesture: gestureValue
        })
          .then(response => {
            console.log('Gesture sent successfully:', response.data);
          })
          .catch(error => {
            console.error('Error sending gesture:', error);
            onSettingsClick();
          });
      }
    };

    let secondTimeoutId: NodeJS.Timeout;

    if (gestureResult !== 0) {
      const timeoutId = setTimeout(() => {
        handleGestureStable();

        secondTimeoutId = setTimeout(() => {
          intervalIdRef.current = window.setInterval(handleGestureStable, 500);
        }, 250);
      }, 150);

      return () => {
        clearTimeout(timeoutId);
        if (secondTimeoutId !== undefined) {
          clearTimeout(secondTimeoutId);
        }
        if (intervalIdRef.current !== undefined) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = undefined;
        }
      };
    }
  }, [gestureResult]);

  useEffect(() => {
    const getUserMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: isUserFacing ? "user" : "environment",
            width: { ideal: 500 },
            height: { ideal: 500 }
          }
        });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video.play().then(() => {
              if (canvasRef.current) {
                canvasRef.current.width = video.videoWidth;
                canvasRef.current.height = video.videoHeight;
                initializeMediaPipe();
              }
            });
          };
        }
      } catch (err) {
        console.error("Error accessing media devices:", err);
      }
    };

    const handleResize = () => {
      setTimeout(() => {
        const video = videoRef.current;
        if (video && canvasRef.current) {
          canvasRef.current.width = video.videoWidth;
          canvasRef.current.height = video.videoHeight;
        }
      }, 1000); // might not be very reliable
    };

    getUserMedia();
    window.addEventListener('resize', handleResize);

    return () => {
      window.addEventListener('resize', handleResize);

      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
      if (handsRef.current) {
        handsRef.current.close();
        handsRef.current = null;
      }
    };
  }, [isUserFacing, flipped]);

  const initializeMediaPipe = () => {
    if (handsRef.current) {
      handsRef.current.close();
    }
    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${VERSION}/${file}`,
    });

    hands.setOptions({
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      maxNumHands: 6,
    });

    hands.onResults(onResults);
    handsRef.current = hands;
    sendToMediaPipe();
  };

  const sendToMediaPipe = async () => {
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    if (videoRef.current && handsRef.current) {
      try {
        await handsRef.current.send({ image: videoRef.current });
      } catch (error) {
        console.error('Error in sendToMediaPipe:', error);
        setTimeout(sendToMediaPipe, 500);
      } finally {
        isSendingRef.current = false;
      }
    } else {
      isSendingRef.current = false;
    }
  };

  const onResults = (results: Results) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const video = videoRef.current;
    if (!canvas || !ctx || !video) return;

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isUserFacing) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let vote = 0;
    results.multiHandLandmarks?.forEach(landmarks => {
      let scaledLandmarks = landmarks.map(landmark => ({
        x: landmark.x * videoWidth,
        y: landmark.y * videoHeight,
        z: landmark.z
      }));

      let gestureResult = getGesture(scaledLandmarks);

      if ((flipped || isUserFacing) && flipped !== isUserFacing) {
        gestureResult = gestureResult === "Left" ? "Right" : gestureResult === "Right" ? "Left" : gestureResult;
      }

      vote += (gestureResult === "Right") ? 1 : (gestureResult === "Left") ? -1 : 0;


      const handStyles: { [key: string]: { connectorStyle: any, landmarkStyle: any } } = {
        'Right': {
          connectorStyle: { color: '#00FF00', lineWidth: 1 },
          landmarkStyle: { color: '#00FF00', radius: 1 }
        },
        'Left': {
          connectorStyle: { color: '#FF0000', lineWidth: 1 },
          landmarkStyle: { color: '#FF0000', radius: 1 }
        },
        'None': {
          connectorStyle: { color: '#00BFFF', lineWidth: .5 },
          landmarkStyle: { color: '#00BFFF', radius: .5 }
        }
      };

      const currentStyle = handStyles[gestureResult] || handStyles['None'];

      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, currentStyle.connectorStyle);
      drawLandmarks(ctx, landmarks, currentStyle.landmarkStyle);

    });
    setGestureResult(vote)

    ctx.restore();
    requestAnimationFrame(sendToMediaPipe);
  };

  const flipCamera = () => {
    setIsUserFacing(!isUserFacing);
  }

  return (
    <div className="camera-container">
      <canvas ref={canvasRef} className="canvas-overlay" />
      <video ref={videoRef} className={`camera-feed ${isUserFacing ? 'user-facing' : ''}`} autoPlay playsInline />

      {!modalVisible && (
        <button onClick={onSettingsClick} className="camera-button show-settings">
          <FontAwesomeIcon icon={faGear} />
        </button>
      )}

      {!modalVisible && (
        <button onClick={flipCamera} className="camera-button switch-camera">
          <FontAwesomeIcon icon={faArrowsRotate} />
        </button>
      )}
    </div>
  );
};

export default Camera;