import React from 'react';
import { PlayCircle, FileText, BrainCircuit, Image as ImageIcon, MessageSquare } from 'lucide-react';

const Card = ({ item }) => {
  const { type, title, url, notes } = item;
  const t = type?.toLowerCase() || 'link';

  const getIcon = () => {
    switch (t) {
      case 'video': return <PlayCircle className="text-red-500 mb-2" size={28} />;
      case 'article': return <FileText className="text-blue-500 mb-2" size={28} />;
      case 'quiz': return <BrainCircuit className="text-purple-500 mb-2" size={28} />;
      case 'image': return <ImageIcon className="text-green-500 mb-2" size={28} />;
      case 'chalktalk': return <MessageSquare className="text-orange-500 mb-2" size={28} />;
      default: return <FileText className="text-gray-500 mb-2" size={28} />;
    }
  };

  const getTypeBadgeColor = () => {
    switch (t) {
      case 'video': return 'bg-red-100 text-red-800 border-red-200';
      case 'article': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'quiz': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'image': return 'bg-green-100 text-green-800 border-green-200';
      case 'chalktalk': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow h-full flex flex-col">
      <div className="p-5 flex-grow">
        <div className="flex justify-between items-start mb-3">
          {getIcon()}
          <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${getTypeBadgeColor()}`}>
            {type || 'Resource'}
          </span>
        </div>
        
        <h3 className="font-bold text-slate-800 text-lg mb-2 leading-tight">{title}</h3>
        
        {t === 'video' && url && (
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black mt-3 mb-4">
            {url.includes('youtube.com/embed') ? (
               <iframe
               className="absolute top-0 left-0 w-full h-full"
               src={url}
               title="YouTube video player"
               allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
               allowFullScreen
             ></iframe>
            ) : (
              <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-full h-full bg-slate-100 text-blue-600 hover:underline">
                View Video Externally
              </a>
            )}
          </div>
        )}

        {t === 'image' && url && (
          <div className="mt-3 mb-4 rounded-lg overflow-hidden border border-slate-100">
             <img src={url} alt={title} className="w-full h-auto object-cover" loading="lazy" />
          </div>
        )}

        {(t === 'quiz' || t === 'chalktalk') && notes && (
          <div className="mt-2 text-slate-600 text-sm whitespace-pre-wrap leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 italic">
            {notes}
          </div>
        )}

        {t !== 'quiz' && t !== 'chalktalk' && notes && (
           <p className="text-slate-600 text-sm leading-relaxed mt-2">{notes}</p>
        )}
      </div>

      {(t === 'article' || (t !== 'video' && t !== 'image' && url)) && url && (
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 mt-auto">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1"
          >
            <span>Read More</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          </a>
        </div>
      )}
    </div>
  );
};

export default Card;