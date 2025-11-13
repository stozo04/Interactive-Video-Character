import React, { useRef, useState } from 'react';
import { UploadedImage } from '../types';
import LoadingSpinner from './LoadingSpinner';

interface ImageUploaderProps {
  onImageUpload: (image: UploadedImage) => void;
  onSelectLocalVideo: (videoFile: File) => void;
  onBack: () => void;
  imagePreview: string | null;
  isSaving: boolean;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read image as base64 string.'));
        return;
      }
      const [, base64Data] = reader.result.split(',');
      resolve(base64Data || '');
    };
    reader.onerror = (error) => reject(error);
  });

const ImageUploader: React.FC<ImageUploaderProps> = ({
  onImageUpload,
  onSelectLocalVideo,
  onBack,
  imagePreview,
  isSaving,
}) => {
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
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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
    <div className="flex flex-col items-center justify-center h-full gap-8 relative">
      <button 
        onClick={onBack} 
        className="absolute top-0 left-0 bg-gray-700/50 hover:bg-gray-600/80 text-white rounded-full p-2 transition-colors"
        aria-label="Back to character selection"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
      </button>

      {imagePreview ? (
        <div className="w-full max-w-md flex flex-col items-center gap-6">
          <img src={imagePreview} alt="Preview" className="rounded-lg shadow-lg max-h-80 object-contain"/>
          <p className="text-gray-300 text-center">
            Your character image is set. Upload a short idle animation video to continue.
          </p>
          <button
            onClick={() => videoFileInputRef.current?.click()}
            disabled={isSaving}
            className="w-full bg-purple-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-purple-500 transition-colors duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <LoadingSpinner /> Saving...
              </>
            ) : (
              'Upload Animation'
            )}
          </button>
          <input
            type="file"
            ref={videoFileInputRef}
            className="hidden"
            accept="video/mp4,video/webm"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onSelectLocalVideo(e.target.files[0]);
                e.target.value = '';
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
