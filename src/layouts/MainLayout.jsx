import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import Sidebar from '../components/Sidebar';

const MainLayout = ({ structure, activeSubspecialty, setActiveSubspecialty }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      
      {/* Mobile menu button */}
      <div className="md:hidden fixed top-0 left-0 w-full z-50 bg-slate-900 text-white p-4 flex items-center justify-between border-b border-slate-700">
        <h1 className="font-bold text-lg tracking-tight">IM Preceptor Guide</h1>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-1 focus:outline-none">
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar - hidden on mobile unless toggled, fixed on desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out md:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar 
          structure={structure} 
          activeSubspecialty={activeSubspecialty} 
          setActiveSubspecialty={setActiveSubspecialty} 
          onNavigate={() => setMobileMenuOpen(false)} // Close menu on mobile when a link is clicked
        />
      </div>

      {/* Overlay for mobile when sidebar is open */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden" 
          onClick={() => setMobileMenuOpen(false)}
        ></div>
      )}

      {/* Main content area */}
      <div className="flex-1 w-full md:ml-64 overflow-y-auto mt-14 md:mt-0">
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;