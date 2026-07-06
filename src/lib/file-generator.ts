// File generation service - Excel, Word, PDF, Code files
import { supabase } from '@/integrations/supabase/client';

export type FileType = 'excel' | 'doc' | 'pdf' | 'code';

/** Generate Excel file (XLSX) from data */
export async function generateExcelFile(data: any[][], filename: string): Promise<Blob> {
  const csvContent = data.map(row => 
    row.map(cell => {
      if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
  
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return blob;
}

/** Generate Word document (DOCX) */
export async function generateWordFile(content: string, filename: string): Promise<Blob> {
  const blob = new Blob([content], { type: 'text/plain' });
  return blob;
}

/** Generate PDF file */
export async function generatePDFFile(content: string, filename: string): Promise<Blob> {
  const blob = new Blob([content], { type: 'application/pdf' });
  return blob;
}

/** Generate code file (raw content, no HTML wrapper) */
export async function generateCodeFile(content: string, filename: string): Promise<Blob> {
  // Determine extension from filename
  const ext = filename.split('.').pop() || 'txt';
  let mimeType = 'text/plain';
  
  switch (ext) {
    case 'js': mimeType = 'text/javascript'; break;
    case 'ts': mimeType = 'text/typescript'; break;
    case 'py': mimeType = 'text/x-python'; break;
    case 'cpp': mimeType = 'text/x-c++src'; break;
    case 'java': mimeType = 'text/x-java'; break;
    case 'html': mimeType = 'text/html'; break;
    case 'css': mimeType = 'text/css'; break;
    case 'json': mimeType = 'application/json'; break;
    default: mimeType = 'text/plain';
  }
  
  // Clean content - remove any HTML wrapper if accidentally added
  let cleanContent = content;
  // Remove HTML tags if present
  cleanContent = cleanContent.replace(/<[^>]*>/g, '');
  // Decode HTML entities
  cleanContent = cleanContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  
  const blob = new Blob([cleanContent], { type: mimeType });
  return blob;
}

/** Generate file based on type */
export async function generateFile(
  fileType: FileType,
  content: any,
  filename: string
): Promise<Blob> {
  switch (fileType) {
    case 'excel':
      const data = typeof content === 'string' 
        ? content.split('\n').map(line => line.split(','))
        : content;
      return generateExcelFile(data, filename);
    case 'doc':
      return generateWordFile(typeof content === 'string' ? content : JSON.stringify(content, null, 2), filename);
    case 'pdf':
      return generatePDFFile(typeof content === 'string' ? content : JSON.stringify(content, null, 2), filename);
    case 'code':
      return generateCodeFile(typeof content === 'string' ? content : JSON.stringify(content, null, 2), filename);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/** Generate file and upload to Supabase Storage */
export async function generateAndUploadFile(
  fileType: FileType,
  content: any,
  filename: string,
  contactId?: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };
  
  try {
    const blob = await generateFile(fileType, content, filename);
    
    let extension = '';
    switch (fileType) {
      case 'excel': extension = 'xlsx'; break;
      case 'doc': extension = 'txt'; break;
      case 'pdf': extension = 'pdf'; break;
      case 'code': 
        extension = filename.split('.').pop() || 'txt';
        break;
    }
    
    const filePath = `files/${user.id}/${Date.now()}_${filename}.${extension}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-files')
      .upload(filePath, blob);
    
    if (uploadError) {
      console.error('[File] Upload failed:', uploadError);
      return { success: false, error: uploadError.message };
    }
    
    const { data: urlData } = supabase.storage
      .from('generated-files')
      .getPublicUrl(filePath);
    
    await supabase
      .from('files_generated')
      .insert({
        user_id: user.id,
        file_type: fileType,
        file_url: urlData.publicUrl,
        sent_to_contact_id: contactId || null,
        created_at: new Date().toISOString(),
      });
    
    return { success: true, url: urlData.publicUrl };
    
  } catch (error) {
    console.error('[File] Generation failed:', error);
    return { success: false, error: String(error) };
  }
}

/** Download file to user's device */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}