import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import Card from '../components/Card';

const ConditionDetail = ({ structure }) => {
  const { subspecialty, condition } = useParams();

  const decodedSub = decodeURIComponent(subspecialty);
  const decodedCond = decodeURIComponent(condition);

  const conditionData = structure[decodedSub]?.[decodedCond] || [];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [subspecialty, condition]);

  const breakpointColumnsObj = {
    default: 3,
    1200: 2,
    768: 1
  };

  if (conditionData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-slate-500 space-y-4">
        <svg className="w-16 h-16 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
        <h2 className="text-2xl font-semibold text-slate-700">No Content Yet</h2>
        <p className="text-center max-w-md">
          Add rows to your Google Sheet for "{decodedCond}" under "{decodedSub}" to see them appear here as interactive cards.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-8 border-b border-slate-200 pb-5">
        <h1 className="text-3xl font-bold text-slate-900 leading-tight">{decodedCond}</h1>
        <p className="mt-2 text-sm font-medium text-slate-500 uppercase tracking-widest">{decodedSub}</p>
      </div>

      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {conditionData.map((item, index) => (
          <Card key={index} item={item} />
        ))}
      </Masonry>
    </div>
  );
};

export default ConditionDetail;