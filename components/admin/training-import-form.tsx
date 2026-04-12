'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Upload, X } from 'lucide-react';

interface FilePreview {
  file: File;
  preview: string;
  type: string;
}

export function TrainingImportForm() {
  const [system, setSystem] = useState('BC');
  const [scoreJson, setScoreJson] = useState('');
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.currentTarget.files;
    if (!selectedFiles) return;

    const newFiles: FilePreview[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const preview = URL.createObjectURL(file);
      newFiles.push({
        file,
        preview,
        type: ''
      });
    }
    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const updateFileType = (index: number, type: string) => {
    setFiles(prev => {
      const updated = [...prev];
      updated[index].type = type;
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!scoreJson.trim()) {
      toast.error('Please enter the official score JSON');
      return;
    }

    // Validate JSON
    let scoreData;
    try {
      scoreData = JSON.parse(scoreJson);
    } catch (err) {
      toast.error('Invalid JSON format. Please check your input.');
      return;
    }

    if (!system) {
      toast.error('Please select a scoring system');
      return;
    }

    setIsLoading(true);

    try {
      // Submit to API
      const formData = new FormData();
      formData.append('scoring_system', system);
      formData.append('score_data', JSON.stringify(scoreData));
      
      // Add files with their types
      files.forEach((f, idx) => {
        formData.append(`file_${idx}`, f.file);
        formData.append(`file_${idx}_type`, f.type || '');
      });

      const response = await fetch('/api/admin/training-import', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to import training data');
      }

      const data = await response.json();
      toast.success('Training data imported successfully');
      
      // Reset form
      setScoreJson('');
      files.forEach(f => URL.revokeObjectURL(f.preview));
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Training import error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import training data');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Scoring System Selection */}
      <div className="space-y-2">
        <Label htmlFor="system">Scoring System</Label>
        <Select value={system} onValueChange={setSystem}>
          <SelectTrigger id="system">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BC">Boone &amp; Crockett</SelectItem>
            <SelectItem value="PY">Pope &amp; Young</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Score JSON Input */}
      <div className="space-y-2">
        <Label htmlFor="scoreJson">
          Official Score Sheet JSON
          <span className="text-destructive ml-1">*</span>
        </Label>
        <p className="text-sm text-muted-foreground">
          Paste the complete official score sheet as JSON (e.g., from scorecard data)
        </p>
        <Textarea
          id="scoreJson"
          value={scoreJson}
          onChange={e => setScoreJson(e.target.value)}
          placeholder={`{\n  "main_beam_left": 25.5,\n  "main_beam_right": 24.2,\n  "gross_score": 185.3\n}`}
          rows={8}
          className="font-mono text-sm"
          disabled={isLoading}
        />
      </div>

      {/* Image Upload Section */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="images">Support Images</Label>
          <p className="text-sm text-muted-foreground">
            Upload photos of the rack from different angles (live, mounted, side views, etc.)
          </p>
        </div>

        {/* File Input */}
        <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            disabled={isLoading}
            className="hidden"
            id="fileInput"
          />
          <label htmlFor="fileInput" className="cursor-pointer">
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="font-medium">Click to upload or drag and drop</p>
            <p className="text-sm text-muted-foreground">PNG, JPG, WEBP up to 10MB each</p>
          </label>
        </div>

        {/* File Preview Grid */}
        {files.length > 0 && (
          <div className="space-y-3">
            <p className="font-medium text-sm">Uploaded Images ({files.length})</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {files.map((f, idx) => (
                <Card key={idx} className="overflow-hidden">
                  <div className="aspect-square overflow-hidden bg-muted relative group">
                    <img
                      src={f.preview}
                      alt={`Preview ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="absolute top-1 right-1 bg-destructive/80 hover:bg-destructive text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  
                  {/* Image Type Selector */}
                  <div className="p-2 bg-background border-t">
                    <Select value={f.type} onValueChange={(type) => updateFileType(idx, type)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="live">Live Photo</SelectItem>
                        <SelectItem value="mounted">Mounted</SelectItem>
                        <SelectItem value="side">Side View</SelectItem>
                        <SelectItem value="front">Front View</SelectItem>
                        <SelectItem value="back">Back View</SelectItem>
                        <SelectItem value="top">Top View</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Submit Button */}
      <Button 
        type="submit" 
        disabled={isLoading || !scoreJson.trim()}
        className="w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Importing Training Data...
          </>
        ) : (
          'Submit Training Data'
        )}
      </Button>
    </form>
  );
}
