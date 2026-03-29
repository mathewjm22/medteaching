import React, { useState, useEffect } from 'react';
import { Routes, Route, HashRouter } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Home from './pages/Home';
import ConditionDetail from './pages/ConditionDetail';
import { fetchSheetData, parseDataStructure } from './services/googleSheets';
import { mockData } from './data/mockData';

function App() {
  const [structure, setStructure] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSubspecialty, setActiveSubspecialty] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        // Try fetching real data if URL is set in env
        const rawData = await fetchSheetData();
        
        if (rawData && rawData.length > 0) {
          setStructure(parseDataStructure(rawData));
        } else {
          // Fallback to mock data
          console.log("Using mock data");
          setStructure(parseDataStructure(mockData));
        }
      } catch (err) {
        console.error("Failed to load data, using mock", err);
        setStructure(parseDataStructure(mockData));
        setError("Could not load from Google Sheets. Showing sample data.");
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