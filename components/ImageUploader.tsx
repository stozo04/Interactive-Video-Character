import React, { useRef, useState } from 'react';
import { UploadedImage } from '../types';
import { fileToBase64 } from '../services/geminiService';
import LoadingSpinner from './LoadingSpinner';

interface ImageUploaderProps {
  onImageUpload: (image: UploadedImage) => void;
  onGenerate: () => void;
  onSelectLocalVideo: (videoFile: File) => void;
  imagePreview: string | null;
  isUploading: boolean;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageUpload, onGenerate, onSelectLocalVideo, imagePreview, isUploading }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFileChange = async (files: FileList | null) => {
    if (files && files[0]) {
      const file = files[0];
      const base64 = await fileToBase64(file);
      onImageUpload({
        file,
        base64,
        mimeType: file.type,
      });
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      {imagePreview ? (
        <div className="w-full max-w-md flex flex-col items-center gap-6">
          <img src={imagePreview} alt="Preview" className="rounded-lg shadow-lg max-h-80 object-contain"/>
          <p className="text-gray-300 text-center">Your character is ready. How should we create the idle animation?</p>
          <div className="w-full flex flex-col sm:flex-row gap-4">
            <button 
              onClick={onGenerate}
              disabled={isUploading}
              className="flex-1 bg-purple-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-purple-500 transition-colors duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isUploading ? <><LoadingSpinner /> Generating...</> : 'Generate Animation'}
            </button>
            <button
              onClick={() => videoFileInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 bg-gray-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-gray-500 transition-colors duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
            >
              Upload Animation
            </button>
          </div>
          <input
            type="file"
            ref={videoFileInputRef}
            className="hidden"
            accept="video/mp4,video/webm"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onSelectLocalVideo(e.target.files[0]);
              }
            }}
          />
        </div>
      ) : (
        <div 
          className={`w-full max-w-lg p-10 border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors ${dragActive ? 'border-purple-500 bg-purple-500/10' : 'border-gray-600 hover:border-purple-500 hover:bg-purple-500/10'}`}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/png, image/jpeg, image/webp"
            onChange={(e) => handleFileChange(e.target.files)}
          />
          <p className="text-gray-400">Drag & drop an image here, or click to select</p>
          <p className="text-sm text-gray-500 mt-2">PNG, JPG, or WEBP</p>
        </div>
      )}
    </div>
  );
};

export default ImageUploader;