/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Sparkles, 
  Check, 
  ChevronRight, 
  Image as ImageIcon, 
  Layout, 
  RefreshCw, 
  ArrowLeft,
  Send,
  Loader2,
  Layers,
  History,
  Download,
  Plus,
  Grid,
  MousePointer2,
  Copy,
  Trash2,
  ShoppingBag,
  ExternalLink,
  Move,
  Paperclip,
  X
} from 'lucide-react';
import Markdown from 'react-markdown';
import { generateStagedImages, generate3DFloorPlan, editStagedImage, transferFeature, getShoppingRecommendations, moveFeature, generateRoomFromFloorPlan, analyzeFloorPlanRooms, renderNewAngleWithConsistency } from './services/gemini';
import { cn } from './lib/utils';
import { BeforeAfterSlider } from './components/BeforeAfterSlider';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type AppState = 'upload' | 'generating' | 'selection' | 'editing' | 'floorplan' | 'gallery';

interface Variation {
  id: string;
  project_id: string;
  project_image_id: string;
  group_id: string;
  image_data: string;
  parent_variation_id: string | null;
  is_subversion: boolean;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  room_type: string;
  images: { id: string, image_data: string }[];
  original_image: string; // fallback for first image
  created_at: string;
  variations?: Variation[];
}

export default function App() {
  const [state, setState] = useState<AppState>('upload');
  const [roomType, setRoomType] = useState<'living room' | 'bedroom' | 'kitchen' | 'exterior' | 'floorplan'>('living room');
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [selectedVariation, setSelectedVariation] = useState<Variation | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  
  // Shopping state
  const [shoppingInfo, setShoppingInfo] = useState<{ text: string, sources: string[] } | null>(null);
  const [isFetchingShopping, setIsFetchingShopping] = useState(false);
  
  // Selection tool state
  const [selection, setSelection] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Feature transfer state
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [sourceVariation, setSourceVariation] = useState<Variation | null>(null);
  const [apiError, setApiError] = useState<'QUOTA' | 'AUTH' | null>(null);
  const [newAngleImage, setNewAngleImage] = useState<string | null>(null);
  const newAngleInputRef = useRef<HTMLInputElement>(null);

  // Move mode specific state
  const [moveSourceBox, setMoveSourceBox] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
  const [showSlider, setShowSlider] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data);
    } catch (error) {
      console.error("Failed to fetch projects", error);
    }
  };

  const loadProject = async (id: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      setCurrentProject(data);
      setVariations(data.variations || []);
      setRoomType(data.room_type);
      if (data.variations?.length > 0) {
        setSelectedVariation(data.variations[data.variations.length - 1]);
        setState(data.room_type === 'floorplan' ? 'floorplan' : 'editing');
      } else {
        setState('selection');
      }
    } catch (error) {
      console.error("Failed to load project", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this project?")) return;
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      fetchProjects();
    } catch (error) {
      console.error("Failed to delete project", error);
    }
  };

  const deleteVariation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (variations.length <= 1) {
      alert("Cannot delete the only variation.");
      return;
    }
    if (!confirm("Delete this variation?")) return;
    try {
      const response = await fetch(`/api/variations/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setVariations(prev => {
          const filtered = prev.filter(v => v.id !== id);
          if (selectedVariation?.id === id) {
            setSelectedVariation(filtered[filtered.length - 1] || null);
          }
          return filtered;
        });
      } else {
        alert("Failed to delete variation from server.");
      }
    } catch (error) {
      console.error("Failed to delete variation", error);
      alert("Error deleting variation.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const projectId = crypto.randomUUID();
        const newProject = {
          id: projectId,
          name: `Project ${projects.length + 1}`,
          roomType: roomType,
          images: [base64]
        };

        // Save project to DB
        await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newProject)
        });

        // Reload project to get IDs
        const res = await fetch(`/api/projects/${projectId}`);
        const data = await res.json();
        setCurrentProject(data);
        
        if (roomType === 'floorplan') {
          handleFloorPlan(base64, projectId, data.images[0].id);
        } else {
          handleInitialStaging(base64, projectId, data.images[0].id);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleInitialStaging = async (imageBase64: string, projectId: string, projectImageId: string) => {
    setState('generating');
    setIsProcessing(true);
    setApiError(null);
    try {
      const results = await generateStagedImages(imageBase64, roomType);
      const newVariations: Variation[] = [];
      
      for (let i = 0; i < results.length; i++) {
        const img = results[i];
        const varId = crypto.randomUUID();
        const variation: Variation = {
          id: varId,
          project_id: projectId,
          project_image_id: projectImageId,
          group_id: crypto.randomUUID(),
          image_data: img,
          parent_variation_id: null,
          is_subversion: false,
          created_at: new Date().toISOString()
        };
        
        await fetch('/api/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...variation,
            projectId,
            projectImageId: variation.project_image_id,
            groupId: variation.group_id,
            imageData: variation.image_data,
            parentVariationId: variation.parent_variation_id,
            isSubversion: variation.is_subversion
          })
        });
        newVariations.push(variation);
      }
      
      setVariations(newVariations);
      setState('selection');
    } catch (error: any) {
      console.error(error);
      if (error.message === 'QUOTA_EXCEEDED') setApiError('QUOTA');
      else if (error.message === 'AUTH_ERROR') setApiError('AUTH');
      else alert("Error generating staged images.");
      setState('upload');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRequestMore = async () => {
    if (!currentProject || !currentProject.images[0]) return;
    setIsProcessing(true);
    try {
      const image = currentProject.images[0].image_data;
      const results = await generateStagedImages(image, roomType, 3);
      const newVariations: Variation[] = [];
      
      for (let i = 0; i < results.length; i++) {
        const img = results[i];
        const varId = crypto.randomUUID();
        const variation: Variation = {
          id: varId,
          project_id: currentProject.id,
          project_image_id: currentProject.images[0].id,
          group_id: crypto.randomUUID(),
          image_data: img,
          parent_variation_id: null,
          is_subversion: false,
          created_at: new Date().toISOString()
        };
        
        await fetch('/api/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...variation,
            projectId: currentProject.id,
            projectImageId: variation.project_image_id,
            groupId: variation.group_id,
            imageData: variation.image_data,
            parentVariationId: variation.parent_variation_id,
            isSubversion: variation.is_subversion
          })
        });
        newVariations.push(variation);
      }
      
      setVariations(prev => [...prev, ...newVariations]);
    } catch (error: any) {
      console.error(error);
      alert("Error generating more variations.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFloorPlan = async (imageBase64: string, projectId: string, projectImageId: string) => {
    setState('generating');
    setIsProcessing(true);
    setApiError(null);
    try {
      // 1. Generate 3D Floor Plan
      const result = await generate3DFloorPlan(imageBase64);
      if (result) {
        const varId = crypto.randomUUID();
        const variation: Variation = {
          id: varId,
          project_id: projectId,
          project_image_id: projectImageId,
          group_id: crypto.randomUUID(),
          image_data: result,
          parent_variation_id: null,
          is_subversion: false,
          created_at: new Date().toISOString()
        };
        
        await fetch('/api/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...variation,
            projectId,
            projectImageId: variation.project_image_id,
            groupId: variation.group_id,
            imageData: variation.image_data,
            parentVariationId: variation.parent_variation_id,
            isSubversion: variation.is_subversion
          })
        });
        
        setVariations([variation]);
        setSelectedVariation(variation);
        setState('floorplan');

        // 2. Analyze rooms and generate initial views automatically
        const rooms = await analyzeFloorPlanRooms(imageBase64);
        // Take top 4 rooms to avoid excessive API calls
        const roomsToGenerate = rooms.slice(0, 4);
        
        for (const room of roomsToGenerate) {
          const roomResult = await generateRoomFromFloorPlan(imageBase64, room);
          if (roomResult) {
            const roomVarId = crypto.randomUUID();
            const roomVariation: Variation = {
              id: roomVarId,
              project_id: projectId,
              project_image_id: projectImageId,
              group_id: crypto.randomUUID(),
              image_data: roomResult,
              parent_variation_id: varId,
              is_subversion: true,
              created_at: new Date().toISOString()
            };

            await fetch('/api/variations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...roomVariation,
                projectId,
                projectImageId: roomVariation.project_image_id,
                groupId: roomVariation.group_id,
                imageData: roomVariation.image_data,
                parentVariationId: roomVariation.parent_variation_id,
                isSubversion: roomVariation.is_subversion
              })
            });
            setVariations(prev => [...prev, roomVariation]);
          }
        }
      }
    } catch (error: any) {
      console.error(error);
      if (error.message === 'QUOTA_EXCEEDED') setApiError('QUOTA');
      else if (error.message === 'AUTH_ERROR') setApiError('AUTH');
      else alert("Error generating 3D floor plan and rooms.");
      setState('upload');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedVariation || !currentProject) return;
    if (!editPrompt && !newAngleImage) return;
    
    setIsProcessing(true);
    setApiError(null);
    try {
      let result: string | null = null;
      let targetProjectImageId = selectedVariation.project_image_id;

      if (newAngleImage) {
        // If a new angle is provided, we first save it as a project image
        const imgRes = await fetch('/api/projects/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: currentProject.id,
            imageData: newAngleImage
          })
        });
        const imgData = await imgRes.json();
        targetProjectImageId = imgData.id;

        // Then render it with consistency
        result = await renderNewAngleWithConsistency(newAngleImage, selectedVariation.image_data, roomType);
      } else {
        result = await editStagedImage(selectedVariation.image_data, editPrompt, selection || undefined);
      }

      if (result) {
        const varId = crypto.randomUUID();
        const newVariation: Variation = {
          id: varId,
          project_id: currentProject.id,
          project_image_id: targetProjectImageId,
          group_id: crypto.randomUUID(),
          image_data: result,
          parent_variation_id: selectedVariation.id,
          is_subversion: true,
          created_at: new Date().toISOString()
        };
        
        await fetch('/api/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...newVariation,
            projectId: currentProject.id,
            projectImageId: newVariation.project_image_id,
            groupId: newVariation.group_id,
            imageData: newVariation.image_data,
            parentVariationId: newVariation.parent_variation_id,
            isSubversion: newVariation.is_subversion
          })
        });
        
        // Refresh project to get new images if any
        const projRes = await fetch(`/api/projects/${currentProject.id}`);
        const projData = await projRes.json();
        setCurrentProject(projData);

        setVariations(prev => [...prev, newVariation]);
        setSelectedVariation(newVariation);
        setEditPrompt('');
        setSelection(null);
        setNewAngleImage(null);
      }
    } catch (error: any) {
      console.error(error);
      if (error.message === 'QUOTA_EXCEEDED') setApiError('QUOTA');
      else if (error.message === 'AUTH_ERROR') setApiError('AUTH');
      else alert("Error editing image.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedVariation || !sourceVariation || !editPrompt || !currentProject) return;
    setIsProcessing(true);
    setApiError(null);
    try {
      const result = await transferFeature(
        selectedVariation.image_data, 
        sourceVariation.image_data, 
        editPrompt,
        selection || undefined
      );
      
      if (result) {
        const varId = crypto.randomUUID();
        const newVariation: Variation = {
          id: varId,
          project_id: currentProject.id,
          project_image_id: selectedVariation.project_image_id,
          group_id: crypto.randomUUID(),
          image_data: result,
          parent_variation_id: selectedVariation.id,
          is_subversion: true,
          created_at: new Date().toISOString()
        };
        
        await fetch('/api/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...newVariation,
            projectId: currentProject.id,
            projectImageId: newVariation.project_image_id,
            groupId: newVariation.group_id,
            imageData: newVariation.image_data,
            parentVariationId: newVariation.parent_variation_id,
            isSubversion: newVariation.is_subversion
          })
        });
        
        setVariations(prev => [...prev, newVariation]);
        setSelectedVariation(newVariation);
        setEditPrompt('');
        setSelection(null);
        setIsTransferMode(false);
        setSourceVariation(null);
      }
    } catch (error: any) {
      console.error(error);
      if (error.message === 'QUOTA_EXCEEDED') setApiError('QUOTA');
      else if (error.message === 'AUTH_ERROR') setApiError('AUTH');
      else alert("Error transferring feature.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMoveFeature = async () => {
    if (!selectedVariation || !moveSourceBox || !selection || !editPrompt || !currentProject) return;
    setIsProcessing(true);
    setApiError(null);
    try {
      const result = await moveFeature(
        selectedVariation.image_data,
        editPrompt,
        moveSourceBox,
        selection
      );

      if (result) {
        const varId = crypto.randomUUID();
        const newVariation: Variation = {
          id: varId,
          project_id: currentProject.id,
          project_image_id: selectedVariation.project_image_id,
          group_id: crypto.randomUUID(),
          image_data: result,
          parent_variation_id: selectedVariation.id,
          is_subversion: true,
          created_at: new Date().toISOString()
        };

        await fetch('/api/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...newVariation,
            projectId: currentProject.id,
            projectImageId: newVariation.project_image_id,
            groupId: newVariation.group_id,
            imageData: newVariation.image_data,
            parentVariationId: newVariation.parent_variation_id,
            isSubversion: newVariation.is_subversion
          })
        });

        setVariations(prev => [...prev, newVariation]);
        setSelectedVariation(newVariation);
        setEditPrompt('');
        setSelection(null);
        setMoveSourceBox(null);
        setIsMoveMode(false);
      }
    } catch (error: any) {
      console.error(error);
      if (error.message === 'QUOTA_EXCEEDED') setApiError('QUOTA');
      else if (error.message === 'AUTH_ERROR') setApiError('AUTH');
      else alert("Error moving feature.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateRoomFromFloorPlan = async () => {
    if (!selectedVariation || !editPrompt || !currentProject) return;
    setIsProcessing(true);
    setApiError(null);
    try {
      const result = await generateRoomFromFloorPlan(currentProject.images[0].image_data, editPrompt);
      if (result) {
        const varId = crypto.randomUUID();
        const newVariation: Variation = {
          id: varId,
          project_id: currentProject.id,
          project_image_id: currentProject.images[0].id,
          group_id: crypto.randomUUID(),
          image_data: result,
          parent_variation_id: selectedVariation.id,
          is_subversion: true,
          created_at: new Date().toISOString()
        };
        
        await fetch('/api/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...newVariation,
            projectId: currentProject.id,
            projectImageId: newVariation.project_image_id,
            groupId: newVariation.group_id,
            imageData: newVariation.image_data,
            parentVariationId: newVariation.parent_variation_id,
            isSubversion: newVariation.is_subversion
          })
        });
        
        setVariations(prev => [...prev, newVariation]);
        setSelectedVariation(newVariation);
        setEditPrompt('');
        setState('editing');
      }
    } catch (error: any) {
      console.error(error);
      if (error.message === 'QUOTA_EXCEEDED') setApiError('QUOTA');
      else if (error.message === 'AUTH_ERROR') setApiError('AUTH');
      else alert("Error generating room view.");
    } finally {
      setIsProcessing(false);
    }
  };
  const handleSelectKey = async () => {
    try {
      await window.aistudio.openSelectKey();
      setApiError(null);
    } catch (error) {
      console.error("Failed to open key selection", error);
    }
  };

  const handleGetShopping = async () => {
    if (!selectedVariation || roomType === 'floorplan' || roomType === 'exterior') return;
    setIsFetchingShopping(true);
    try {
      const info = await getShoppingRecommendations(selectedVariation.image_data, roomType);
      setShoppingInfo(info);
    } catch (error: any) {
      console.error(error);
      if (error.message === 'QUOTA_EXCEEDED') setApiError('QUOTA');
      else if (error.message === 'AUTH_ERROR') setApiError('AUTH');
      else alert("Error fetching shopping recommendations.");
    } finally {
      setIsFetchingShopping(false);
    }
  };

  // Selection tool handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageContainerRef.current || isProcessing || showSlider) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setStartPos({ x, y });
    setSelection({ x, y, w: 0, h: 0 });
    setIsSelecting(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;
    
    setSelection({
      x: Math.min(startPos.x, currentX),
      y: Math.min(startPos.y, currentY),
      w: Math.abs(currentX - startPos.x),
      h: Math.abs(currentY - startPos.y)
    });
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
    if (selection && (selection.w < 1 || selection.h < 1)) {
      setSelection(null);
    } else if (isMoveMode && selection && !moveSourceBox) {
      // If in move mode and we just selected the source, store it and clear selection for target
      setMoveSourceBox(selection);
      setSelection(null);
    }
  };

  const reset = () => {
    setState('upload');
    setCurrentProject(null);
    setVariations([]);
    setSelectedVariation(null);
    setEditPrompt('');
    setSelection(null);
    setIsTransferMode(false);
    setIsMoveMode(false);
    setMoveSourceBox(null);
    setSourceVariation(null);
    setShoppingInfo(null);
    setShowSlider(false);
    fetchProjects();
  };

  return (
    <div className="min-h-screen bg-[#fdfcfb] selection:bg-black selection:text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <span className="font-serif text-xl font-bold tracking-tight">LuxStage AI</span>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => { setState('gallery'); fetchProjects(); }}
            className="text-sm font-medium flex items-center gap-2 hover:opacity-70 transition-opacity"
          >
            <Grid className="w-4 h-4" />
            Projects
          </button>
          {state !== 'upload' && (
            <button 
              onClick={reset}
              className="text-sm font-medium flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Start New
            </button>
          )}
        </div>
      </header>

      <main className="pt-24 pb-12 px-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {state === 'upload' && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center text-center space-y-12"
            >
              <div className="space-y-4">
                <h1 className="text-5xl md:text-7xl font-serif font-bold tracking-tight leading-tight">
                  Luxury Staging <br />
                  <span className="italic text-black/40">in one click.</span>
                </h1>
                <p className="text-black/60 max-w-xl mx-auto text-lg">
                  Transform empty spaces or outdated interiors into high-end luxury apartments using advanced AI.
                </p>
              </div>

              {apiError && (
                <div className="max-w-xl w-full bg-red-50 border border-red-100 p-6 rounded-3xl space-y-4">
                  <div className="flex items-center gap-3 text-red-600">
                    <Sparkles className="w-5 h-5" />
                    <h3 className="font-bold">
                      {apiError === 'QUOTA' ? 'Quota Exceeded' : 'Authentication Error'}
                    </h3>
                  </div>
                  <p className="text-sm text-red-600/70 leading-relaxed">
                    {apiError === 'QUOTA' 
                      ? "The shared API quota has been reached. You can continue by selecting your own Google Cloud API key."
                      : "There was an issue with the API key. Please select a valid paid Google Cloud project key."}
                  </p>
                  <button 
                    onClick={handleSelectKey}
                    className="bg-red-600 text-white px-6 py-2 rounded-full text-sm font-bold hover:bg-red-700 transition-colors"
                  >
                    Select My Own API Key
                  </button>
                  <p className="text-[10px] text-red-600/40">
                    Learn more at <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline">ai.google.dev/gemini-api/docs/billing</a>
                  </p>
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-4">
                {(['living room', 'bedroom', 'kitchen', 'exterior', 'floorplan'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setRoomType(type)}
                    className={cn(
                      "px-6 py-3 rounded-full text-sm font-medium transition-all border",
                      roomType === type 
                        ? "bg-black text-white border-black" 
                        : "bg-white text-black border-black/10 hover:border-black/30"
                    )}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-2xl aspect-[16/9] border-2 border-dashed border-black/10 rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-black/30 hover:bg-black/[0.02] transition-all group"
              >
                <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-black/40" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-lg">Click to upload your {roomType}</p>
                  <p className="text-sm text-black/40">JPEG, PNG up to 10MB. Single image only.</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleFileUpload} 
                />
              </div>
            </motion.div>
          )}

          {state === 'gallery' && (
            <motion.div 
              key="gallery"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-4xl font-serif font-bold">Your Projects</h2>
                <button onClick={() => setState('upload')} className="bg-black text-white px-6 py-2 rounded-full text-sm font-bold">New Project</button>
              </div>
              <div className="grid md:grid-cols-3 gap-8">
                {projects.map((project) => (
                  <div 
                    key={project.id}
                    onClick={() => loadProject(project.id)}
                    className="group cursor-pointer space-y-4"
                  >
                    <div className="aspect-[4/3] rounded-3xl overflow-hidden luxury-shadow relative">
                      <img src={project.original_image} alt={project.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                      <div className="absolute top-4 left-4 glass px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">
                        {project.room_type}
                      </div>
                      <button 
                        onClick={(e) => deleteProject(e, project.id)}
                        className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-red-500/80 text-white rounded-full backdrop-blur-md transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <h3 className="font-serif text-xl font-bold">{project.name}</h3>
                      <p className="text-black/40 text-sm">{new Date(project.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
                {projects.length === 0 && (
                  <div className="col-span-3 py-24 text-center text-black/20 italic">
                    No projects saved yet.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {state === 'generating' && (
            <motion.div 
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-24 space-y-8"
            >
              <div className="relative">
                <div className="w-24 h-24 border-4 border-black/5 border-t-black rounded-full animate-spin" />
                <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-black" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-serif font-bold">Crafting Luxury</h2>
                <p className="text-black/40 italic">Transforming your space into a high-end masterpiece...</p>
              </div>
            </motion.div>
          )}

          {state === 'selection' && (
            <motion.div 
              key="selection"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-serif font-bold">Choose Your Aesthetic</h2>
                <p className="text-black/40">Select one of the variations to refine or finalize.</p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                {variations.filter(v => !v.is_subversion).map((v, idx) => (
                  <motion.div
                    key={v.id}
                    whileHover={{ y: -10 }}
                    onClick={() => {
                      setSelectedVariation(v);
                      setState('editing');
                    }}
                    className="group cursor-pointer space-y-4"
                  >
                    <div className="aspect-[3/4] rounded-3xl overflow-hidden luxury-shadow relative">
                      <img src={v.image_data} alt={`Option ${idx + 1}`} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="bg-white text-black px-6 py-2 rounded-full font-bold text-sm">
                          Select & Refine
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center px-2">
                      <span className="font-serif italic text-lg">Variation {idx + 1}</span>
                      <ChevronRight className="w-5 h-5 text-black/20" />
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="flex justify-center">
                <button 
                  onClick={handleRequestMore}
                  disabled={isProcessing}
                  className="flex items-center gap-2 bg-black text-white px-8 py-4 rounded-full font-bold hover:scale-105 transition-transform disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                  Request More Variations
                </button>
              </div>
            </motion.div>
          )}

          {(state === 'editing' || state === 'floorplan') && (
            <motion.div 
              key="editing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid md:grid-cols-12 gap-12"
            >
              {/* Left Column: Image and History */}
              <div className="md:col-span-8 space-y-6">
                <div 
                  ref={imageContainerRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  className={cn(
                    "relative rounded-3xl overflow-hidden luxury-shadow bg-black/5 aspect-[4/3] select-none",
                    showSlider ? "cursor-default" : "cursor-crosshair"
                  )}
                >
                  {isProcessing && (
                    <div className="absolute inset-0 z-20 bg-white/40 backdrop-blur-sm flex items-center justify-center">
                      <Loader2 className="w-12 h-12 animate-spin text-black" />
                    </div>
                  )}
                  {selectedVariation && (
                    showSlider ? (
                      <BeforeAfterSlider 
                        before={currentProject?.images.find(img => img.id === selectedVariation.project_image_id)?.image_data || currentProject?.original_image || ''} 
                        after={selectedVariation.image_data} 
                        className="w-full h-full"
                      />
                    ) : (
                      <img src={selectedVariation.image_data} alt="Staged" className="w-full h-full object-cover pointer-events-none" />
                    )
                  )}
                  
                  {/* Selection Overlay */}
                  {!showSlider && selection && (
                    <div 
                      className="absolute border-2 border-white border-dashed bg-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)] z-10"
                      style={{
                        left: `${selection.x}%`,
                        top: `${selection.y}%`,
                        width: `${selection.w}%`,
                        height: `${selection.h}%`
                      }}
                    >
                      <div className="absolute -top-6 left-0 bg-white text-black text-[10px] px-2 py-0.5 rounded font-bold uppercase">
                        {isMoveMode && moveSourceBox ? 'Target Position' : 'Target Area'}
                      </div>
                    </div>
                  )}

                  {!showSlider && isMoveMode && moveSourceBox && (
                    <div 
                      className="absolute border-2 border-emerald-400 border-dashed bg-emerald-400/20 z-10"
                      style={{
                        left: `${moveSourceBox.x}%`,
                        top: `${moveSourceBox.y}%`,
                        width: `${moveSourceBox.w}%`,
                        height: `${moveSourceBox.h}%`
                      }}
                    >
                      <div className="absolute -top-6 left-0 bg-emerald-400 text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase">
                        Source Item
                      </div>
                    </div>
                  )}
                </div>

                {/* Sub-versions / History */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-serif text-xl font-bold flex items-center gap-2">
                      <History className="w-5 h-5" />
                      Evolution History
                    </h3>
                    <button 
                      onClick={() => setShowSlider(!showSlider)}
                      className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border",
                        showSlider 
                          ? "bg-black text-white border-black" 
                          : "bg-white text-black border-black/10 hover:border-black/30"
                      )}
                    >
                      {showSlider ? 'Hide Comparison' : 'Compare with Original'}
                    </button>
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                    {variations.map((v, idx) => (
                      <div 
                        key={v.id}
                        className="relative flex-shrink-0 group/var"
                      >
                        <div 
                          onClick={() => setSelectedVariation(v)}
                          className={cn(
                            "w-24 aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all",
                            selectedVariation?.id === v.id ? "border-black scale-105" : "border-transparent opacity-60 hover:opacity-100"
                          )}
                        >
                          <img src={v.image_data} className="w-full h-full object-cover" />
                        </div>
                        <button 
                          onClick={(e) => deleteVariation(e, v.id)}
                          className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover/var:opacity-100 transition-opacity shadow-lg z-20 hover:bg-red-600"
                          title="Delete Variation"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Controls */}
              <div className="md:col-span-4 space-y-8">
                <div className="space-y-2">
                  <h2 className="text-3xl font-serif font-bold">
                    {state === 'floorplan' ? '3D Visualization' : 'Refine Design'}
                  </h2>
                  <p className="text-black/40 text-sm uppercase tracking-widest font-bold">
                    {isTransferMode ? 'Feature Transfer' : 'Interactive Editing'}
                  </p>
                </div>

                {state === 'floorplan' ? (
                  <div className="space-y-6">
                    <div className="bg-black/5 p-6 rounded-3xl space-y-4">
                      <h3 className="font-serif font-bold">Generate Room Views</h3>
                      <p className="text-xs text-black/60">Describe a room from the floor plan to generate a photorealistic 3D view.</p>
                      <div className="relative">
                        <textarea
                          value={editPrompt}
                          onChange={(e) => setEditPrompt(e.target.value)}
                          placeholder="e.g. 'The master bedroom with floor-to-ceiling windows'"
                          className="w-full h-24 bg-white border border-black/10 rounded-2xl p-4 text-sm focus:outline-none focus:border-black transition-colors resize-none"
                        />
                        <button 
                          onClick={handleGenerateRoomFromFloorPlan}
                          disabled={!editPrompt || isProcessing}
                          className="absolute bottom-4 right-4 w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <h3 className="font-serif font-bold">Outdoor Views</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <button 
                          onClick={() => { setEditPrompt('The courtyard view'); handleGenerateRoomFromFloorPlan(); }}
                          className="p-4 rounded-2xl border border-black/10 hover:border-black transition-all text-left space-y-2"
                        >
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                          <span className="text-xs font-bold block">Courtyard</span>
                        </button>
                        <button 
                          onClick={() => { setEditPrompt('The front exterior view'); handleGenerateRoomFromFloorPlan(); }}
                          className="p-4 rounded-2xl border border-black/10 hover:border-black transition-all text-left space-y-2"
                        >
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                          <span className="text-xs font-bold block">Exterior</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Mode Toggle */}
                    <div className="flex bg-black/5 p-1 rounded-2xl">
                      <button 
                        onClick={() => { setIsTransferMode(false); setIsMoveMode(false); }}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold transition-all",
                          (!isTransferMode && !isMoveMode) ? "bg-white shadow-sm text-black" : "text-black/40"
                        )}
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => { setIsTransferMode(true); setIsMoveMode(false); }}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold transition-all",
                          isTransferMode ? "bg-white shadow-sm text-black" : "text-black/40"
                        )}
                      >
                        Transfer
                      </button>
                      <button 
                        onClick={() => { setIsMoveMode(true); setIsTransferMode(false); setMoveSourceBox(null); }}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold transition-all",
                          isMoveMode ? "bg-white shadow-sm text-black" : "text-black/40"
                        )}
                      >
                        Move
                      </button>
                    </div>

                    {isTransferMode ? (
                      <div className="space-y-4">
                        <p className="text-xs text-black/60">
                          1. Select a source variation below.<br />
                          2. Describe the feature to move (e.g. "lamp").<br />
                          3. (Optional) Highlight the feature on the source image.
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {variations.filter(v => v.id !== selectedVariation?.id).map((v) => (
                            <div 
                              key={v.id}
                              onClick={() => setSourceVariation(v)}
                              className={cn(
                                "aspect-square rounded-lg overflow-hidden cursor-pointer border-2",
                                sourceVariation?.id === v.id ? "border-black" : "border-transparent opacity-60"
                              )}
                            >
                              <img src={v.image_data} className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                        {sourceVariation && (
                          <div className="relative">
                            <textarea
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                              placeholder="Which feature to transfer? (e.g. 'The chandelier')"
                              className="w-full h-24 bg-white border border-black/10 rounded-2xl p-4 text-sm focus:outline-none focus:border-black transition-colors resize-none"
                            />
                            <button 
                              onClick={handleTransfer}
                              disabled={!editPrompt || isProcessing}
                              className="absolute bottom-4 right-4 w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-50"
                            >
                              <Copy className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ) : isMoveMode ? (
                      <div className="space-y-4">
                        <p className="text-xs text-black/60">
                          {!moveSourceBox 
                            ? "1. Highlight the item you want to move on the image." 
                            : "2. Now highlight the target position for the item."}
                        </p>
                        {moveSourceBox && (
                          <div className="relative">
                            <textarea
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                              placeholder="What are you moving? (e.g. 'The armchair')"
                              className="w-full h-24 bg-white border border-black/10 rounded-2xl p-4 text-sm focus:outline-none focus:border-black transition-colors resize-none"
                            />
                            <button 
                              onClick={handleMoveFeature}
                              disabled={!editPrompt || !selection || isProcessing}
                              className="absolute bottom-4 right-4 w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-50"
                            >
                              <Move className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                        {moveSourceBox && (
                          <button 
                            onClick={() => setMoveSourceBox(null)}
                            className="text-[10px] font-bold uppercase tracking-widest text-black/40 hover:text-black"
                          >
                            Reselect Source Item
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-xs text-black/60">
                          Describe edits, use the selection tool, or upload a new angle to render with the same style.
                        </p>
                        <div className="relative group/edit">
                          <textarea
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            placeholder={newAngleImage ? "Describe the new angle (optional)..." : "Describe refinements... (e.g. 'Change the rug to silk')"}
                            className="w-full h-32 bg-white border border-black/10 rounded-2xl p-4 pt-12 text-sm focus:outline-none focus:border-black transition-colors resize-none"
                          />
                          
                          {/* New Angle Attachment UI */}
                          <div className="absolute top-3 left-4 flex items-center gap-2">
                            <button 
                              onClick={() => newAngleInputRef.current?.click()}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border",
                                newAngleImage 
                                  ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                                  : "bg-black/5 text-black/60 border-transparent hover:bg-black/10"
                              )}
                            >
                              <Paperclip className="w-3 h-3" />
                              {newAngleImage ? "Angle Attached" : "Attach New Angle"}
                            </button>
                            {newAngleImage && (
                              <button 
                                onClick={() => setNewAngleImage(null)}
                                className="p-1 hover:bg-black/5 rounded-full transition-colors"
                              >
                                <X className="w-3 h-3 text-black/40" />
                              </button>
                            )}
                          </div>

                          {newAngleImage && (
                            <div className="absolute top-12 left-4 w-12 h-12 rounded-lg overflow-hidden border border-black/10 shadow-sm pointer-events-none">
                              <img src={newAngleImage} className="w-full h-full object-cover" />
                            </div>
                          )}

                          <input 
                            type="file" 
                            ref={newAngleInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = (ev) => setNewAngleImage(ev.target?.result as string);
                                reader.readAsDataURL(file);
                              }
                            }}
                          />

                          <button 
                            onClick={handleEdit}
                            disabled={(!editPrompt && !newAngleImage) || isProcessing}
                            className="absolute bottom-4 right-4 w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-50"
                          >
                            <Send className="w-5 h-5" />
                          </button>
                        </div>
                        {selection && (
                          <button 
                            onClick={() => setSelection(null)}
                            className="text-[10px] font-bold uppercase tracking-widest text-black/40 hover:text-black"
                          >
                            Clear Selection
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  {roomType !== 'floorplan' && roomType !== 'exterior' && (
                    <button 
                      onClick={handleGetShopping}
                      disabled={isFetchingShopping}
                      className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50"
                    >
                      {isFetchingShopping ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <ShoppingBag className="w-5 h-5" />
                      )}
                      Shop This Look
                    </button>
                  )}
                  <button 
                    className="w-full bg-black text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-black/80 transition-colors"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = selectedVariation!.image_data;
                      link.download = `luxstage-${Date.now()}.png`;
                      link.click();
                    }}
                  >
                    <Download className="w-5 h-5" />
                    Download Result
                  </button>
                  <button 
                    onClick={() => {
                      if (state === 'floorplan') reset();
                      else setState('selection');
                    }}
                    className="w-full border border-black/10 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-black/5 transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Options
                  </button>
                </div>

                <div className="p-6 bg-black/5 rounded-3xl space-y-4">
                  <h3 className="font-bold flex items-center gap-2 text-sm">
                    <MousePointer2 className="w-4 h-4" />
                    Pro Tip
                  </h3>
                  <p className="text-[11px] text-black/60 leading-relaxed">
                    Click and drag on the image to highlight a specific area for more precise AI editing.
                  </p>
                </div>

                {shoppingInfo && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-6 bg-emerald-50 border border-emerald-100 rounded-3xl space-y-4"
                  >
                    <h3 className="font-bold flex items-center gap-2 text-emerald-900">
                      <ShoppingBag className="w-4 h-4" />
                      Shopping List & Budget
                    </h3>
                    <div className="prose prose-xs text-emerald-900/70 max-h-96 overflow-y-auto scrollbar-hide">
                      <Markdown>{shoppingInfo.text}</Markdown>
                    </div>
                    {shoppingInfo.sources.length > 0 && (
                      <div className="pt-4 border-t border-emerald-100">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-900/40 mb-2">Sources</p>
                        <div className="flex flex-wrap gap-2">
                          {shoppingInfo.sources.map((url, i) => (
                            <a 
                              key={i} 
                              href={url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[10px] text-emerald-600 hover:underline flex items-center gap-1"
                            >
                              Source {i + 1} <ExternalLink className="w-2 h-2" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-black/5 text-center">
        <p className="text-black/20 text-xs font-mono tracking-widest uppercase">
          LuxStage AI © 2026 • Powered by Google Gemini
        </p>
      </footer>
    </div>
  );
}
