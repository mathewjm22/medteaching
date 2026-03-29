import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import Card from '../components/Card';
import { fetchConditionFiles } from '../services/googleDrive';

const ConditionDetail = ({ structure }) => {
  const { subspecialty, condition } = useParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const decodedSub = decodeURIComponent(subspecialty);
  const decodedCond = decodeURIComponent(condition);

  const conditionData = structure[decodedSub]?.[decodedCond];

  useEffect(() => {
    window.scrollTo(0, 0);

    const loadFiles = async () => {
      if (!conditionData || !conditionData._folderId) {
        // Mock data or missing folder
        setItems(conditionData?.items || []);
        return;
      }

      // If we already fetched the items, use them
      if (conditionData.items && conditionData.items.length > 0) {
        setItems(conditionData.items);
        return;
      }

      setLoading(true);
      try {
        const fetchedItems = await fetchConditionFiles(conditionData._folderId);
        conditionData.items = fetchedItems; // Cache them
        setItems(fetchedItems);
      } catch (error) {
        console.error("Failed to load files:", error);
      } finally {
        setLoading(false);
      }
    };

    loadFiles();
  }, [subspecialty, condition, conditionData]);

  const breakpointColumnsObj = {
    default: 3,
    1200: 2,
    768: 1
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-slate-500 space-y-4">
        <svg className="w-16 h-16 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
        <h2 className="text-2xl font-semibold text-slate-700">No Content Yet</h2>
        <p className="text-center max-w-md">
          Add files to the Google Drive folder for "{decodedCond}" under "{decodedSub}" to see them appear here as interactive cards.
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
        {items.map((item, index) => (
          <Card key={item.id || index} item={item} />
        ))}
      </Masonry>
    </div>
  );
};

export default ConditionDetail;