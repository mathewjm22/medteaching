import React, { useState, useEffect } from 'react';
import { Routes, Route, HashRouter } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Home from './pages/Home';
import ConditionDetail from './pages/ConditionDetail';
import { fetchFolderStructure } from './services/googleDrive';
import { mockData } from './data/mockData';

function App() {
  const [structure, setStructure] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSubspecialty, setActiveSubspecialty] = useState(null);

  // Re-implement basic mock parser just in case Drive API fails without a key
  const fallbackMockData = () => {
    const struct = {};
    mockData.forEach(item => {
      const sub = item.Subspecialty;
      const cond = item.Condition;
      if (!struct[sub]) struct[sub] = {};
      if (!struct[sub][cond]) struct[sub][cond] = { _folderId: 'mock', items: [] };
      struct[sub][cond].items.push({
        type: item.Type || 'link',
        title: item.Title,
        url: item.Content_URL,
        notes: item.Notes
      });
    });
    return struct;
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        // Fetch folder hierarchy from Google Drive
        const driveStructure = await fetchFolderStructure();

        if (Object.keys(driveStructure).length > 0) {
          setStructure(driveStructure);
        } else {
          console.log("Using mock data (Drive returned empty or no key)");
          setStructure(fallbackMockData());
        }
      } catch (err) {
        console.error("Failed to load data from Drive, using mock", err);
        setStructure(fallbackMockData());
        setError("Could not load from Google Drive. Showing sample data.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-slate-500 font-medium animate-pulse">Loading curriculum...</p>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route 
          path="/" 
          element={
            <MainLayout 
              structure={structure} 
              activeSubspecialty={activeSubspecialty} 
              setActiveSubspecialty={setActiveSubspecialty} 
            />
          }
        >
          <Route index element={<Home />} />
          <Route path="condition/:subspecialty/:condition" element={<ConditionDetail structure={structure} />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;