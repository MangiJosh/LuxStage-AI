import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const getAI = () => {
  // Prefer the user-selected API key (process.env.API_KEY) over the environment default
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
};

const handleApiError = (error: any) => {
  console.error("Gemini API Error:", error);
  const message = error?.message || String(error);
  
  if (message.includes("quota") || message.includes("429")) {
    throw new Error("QUOTA_EXCEEDED");
  }
  if (message.includes("API key") || message.includes("401") || message.includes("not found")) {
    throw new Error("AUTH_ERROR");
  }
  throw error;
};

export const analyzeRoomAndPropose = async (imageBase64: string, roomType: string) => {
  try {
    const ai = getAI();
    const prompt = `Analyze this ${roomType} and propose a luxury staging plan. 
    Describe the current state briefly and then detail a high-end, sophisticated interior design strategy. 
    Focus on furniture, lighting, textures, and color palette. 
    Keep the response concise but evocative. Use Markdown.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: imageBase64.split(",")[1], mimeType: "image/jpeg" } },
          { text: prompt }
        ]
      }
    });

    return response.text;
  } catch (error) {
    return handleApiError(error);
  }
};

export const generateStagedImages = async (imageBase64: string, roomType: string, count: number = 3) => {
  try {
    const ai = getAI();
    
    const promises = Array.from({ length: count }).map(async (_, i) => {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [
            { inlineData: { data: imageBase64.split(",")[1], mimeType: "image/jpeg" } },
            { text: `Apply luxury staging to this ${roomType}. 
            Variation ${i + 1}: Create a high-end, photorealistic interior design. 
            CRITICAL ARCHITECTURAL RULES:
            - DO NOT move or remove walls, windows, doors, or columns.
            - DO NOT change the ceiling height or structural beams.
            - DO NOT change the flooring material unless it's clearly unfinished.
            - PRESERVE the exact layout and perspective of the original image.
            
            STAGING INSTRUCTIONS:
            - ONLY add sophisticated furniture, elegant lighting, and premium decor.
            - Ensure all items are realistically scaled and placed.
            - Ensure the result is a complete, beautifully staged room.` }
          ]
        }
      });

      const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      return part ? `data:image/png;base64,${part.inlineData.data}` : null;
    });

    const resolved = await Promise.all(promises);
    return resolved.filter((img): img is string => img !== null);
  } catch (error) {
    return handleApiError(error);
  }
};

export const generate3DFloorPlan = async (imageBase64: string) => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { data: imageBase64.split(",")[1], mimeType: "image/jpeg" } },
          { text: "Transform this 2D floor plan into a high-quality, photorealistic 3D floor plan with realistic textures, furniture, and lighting. Top-down isometric view." }
        ]
      }
    });

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch (error) {
    return handleApiError(error);
  }
};

export const transferFeature = async (
  targetImageBase64: string, 
  sourceImageBase64: string, 
  featureDescription: string,
  selectionBox?: { x: number, y: number, w: number, h: number }
) => {
  try {
    const ai = getAI();
    const selectionText = selectionBox 
      ? `The feature is located at approximately x:${selectionBox.x}%, y:${selectionBox.y}% with size ${selectionBox.w}%x${selectionBox.h}% in the source image.`
      : "";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { data: targetImageBase64.split(",")[1], mimeType: "image/png" } },
          { inlineData: { data: sourceImageBase64.split(",")[1], mimeType: "image/png" } },
          { text: `Take the ${featureDescription} from the second image (source) and apply it to the first image (target). 
          ${selectionText}
          Maintain the style and lighting of the target image while integrating the new feature seamlessly. 
          The result should be a high-quality, photorealistic interior design image.` }
        ]
      }
    });

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch (error) {
    return handleApiError(error);
  }
};

export const editStagedImage = async (imageBase64: string, editPrompt: string, selectionBox?: { x: number, y: number, w: number, h: number }) => {
  try {
    const ai = getAI();
    const selectionText = selectionBox 
      ? `Apply the edit specifically to the area at x:${selectionBox.x}%, y:${selectionBox.y}% with size ${selectionBox.w}%x${selectionBox.h}% in the image.`
      : "";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { data: imageBase64.split(",")[1], mimeType: "image/png" } },
          { text: `${editPrompt}. ${selectionText} Ensure the result is photorealistic and maintains the luxury aesthetic.` }
        ]
      }
    });

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch (error) {
    return handleApiError(error);
  }
};

export const getShoppingRecommendations = async (imageBase64: string, roomType: string) => {
  try {
    const ai = getAI();
    const prompt = `Analyze this staged ${roomType} image. 
    Identify key furniture pieces, lighting fixtures, and appliances shown. 
    For each item:
    1. Suggest 2-3 specific, high-end products available online that match this style.
    2. Provide links to reputable online shops (e.g., West Elm, Restoration Hardware, Wayfair Professional, Samsung, etc.).
    3. Estimate the cost for each item.
    
    Finally, provide a total estimated budget to furnish/equip this room to this standard.
    Use Markdown for the response. Be specific and helpful.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: imageBase64.split(",")[1], mimeType: "image/png" } },
          { text: prompt }
        ]
      },
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    return {
      text: response.text,
      sources: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(chunk => chunk.web?.uri).filter(Boolean) as string[]
    };
  } catch (error) {
    return handleApiError(error);
  }
};

export const moveFeature = async (
  imageBase64: string, 
  featureDescription: string,
  sourceBox: { x: number, y: number, w: number, h: number },
  targetBox: { x: number, y: number, w: number, h: number }
) => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { data: imageBase64.split(",")[1], mimeType: "image/png" } },
          { text: `In this image, take the ${featureDescription} located at [x:${sourceBox.x}%, y:${sourceBox.y}%, w:${sourceBox.w}%, h:${sourceBox.h}%] and move it to the new position at [x:${targetBox.x}%, y:${targetBox.y}%, w:${targetBox.w}%, h:${targetBox.h}%]. 
          Perfectly integrate the moved item into the new position, adjusting shadows, lighting, and perspective to match the surroundings. 
          The original position of the item should be filled in realistically as if the item was never there. 
          The result must be a high-quality, photorealistic interior design image.` }
        ]
      }
    });

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch (error) {
    return handleApiError(error);
  }
};

export const generateRoomFromFloorPlan = async (floorPlanBase64: string, roomDescription: string) => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { data: floorPlanBase64.split(",")[1], mimeType: "image/jpeg" } },
          { text: `Based on this floor plan, generate a high-end, photorealistic interior view of the ${roomDescription}. 
          The view should be from a human perspective inside the room. 
          Follow the layout and dimensions indicated in the floor plan. 
          Apply luxury staging with sophisticated furniture and lighting.` }
        ]
      }
    });

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch (error) {
    return handleApiError(error);
  }
};

export const analyzeFloorPlanRooms = async (floorPlanBase64: string) => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: floorPlanBase64.split(",")[1], mimeType: "image/jpeg" } },
          { text: "List the main rooms and areas shown in this floor plan. Return only a simple comma-separated list of room names (e.g., Living Room, Kitchen, Master Bedroom, Bathroom, Exterior Front, Backyard)." }
        ]
      }
    });

    return response.text.split(",").map(s => s.trim()).filter(Boolean);
  } catch (error) {
    return handleApiError(error);
  }
};

export const renderNewAngleWithConsistency = async (newAngleBase64: string, referenceStagedBase64: string, roomType: string) => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { data: newAngleBase64.split(",")[1], mimeType: "image/jpeg" } },
          { inlineData: { data: referenceStagedBase64.split(",")[1], mimeType: "image/png" } },
          { text: `This is a new camera angle of the same ${roomType}. 
          
          YOUR TASK: Generate a staged version of the FIRST image (the new angle).
          
          CRITICAL SPATIAL CONSISTENCY RULES:
          1. ENVIRONMENTAL MAPPING: Use permanent structures (walls, windows, doors, columns, corners) in both images to anchor the 3D space. You MUST understand that the FIRST image is the same room as the SECOND image, just from a different viewpoint.
          2. FIXED FURNITURE PLACEMENT: Every piece of furniture and decor from the SECOND image must remain in the EXACT SAME physical location relative to the walls and windows in the FIRST image. For example, if a sofa is against a specific wall under a window in the reference, it MUST be against that same wall under that same window in the new angle.
          3. PERSPECTIVE TRANSFORMATION: Re-render all items (sofas, tables, lamps, etc.) with the correct 3D rotation, foreshortening, and scale to match the new camera perspective of the FIRST image.
          4. STYLE & ASSET LOCK: Use the identical furniture models, textures, fabrics, and colors shown in the SECOND image.
          5. ARCHITECTURAL INTEGRITY: Do not modify any structural elements of the room.
          
          The result must be a high-quality, photorealistic interior design image that feels like a real photograph taken from a different spot in the same staged room.` }
        ]
      }
    });

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch (error) {
    return handleApiError(error);
  }
};
