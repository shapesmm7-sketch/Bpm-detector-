import React, { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';

interface SpectrumVisualizerProps {
  analyserNode: AnalyserNode | null;
  isPlaying: boolean;
}

export const SpectrumVisualizer: React.FC<SpectrumVisualizerProps> = ({ analyserNode, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const width = canvas.width;
    const height = canvas.height;

    const render = () => {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, width, height);

      if (analyserNode && isPlaying) {
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);

        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height;

          // Gradient color: Bass (Emerald/Cyan) to Treble (Violet)
          const hue = 160 + (i / bufferLength) * 120;
          ctx.fillStyle = `hsl(${hue}, 80%, 55%)`;

          ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
          x += barWidth;
          if (x >= width) break;
        }
      } else {
        // Idle spectral animation
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyserNode, isPlaying]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-lg">
      <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400 font-medium">
        <Activity className="w-3.5 h-3.5 text-cyan-400" />
        <span>Real-Time Spectrum FFT</span>
      </div>
      <div className="h-20 bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
        <canvas ref={canvasRef} width={400} height={80} className="w-full h-full block" />
      </div>
    </div>
  );
};
