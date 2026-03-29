import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, ChevronRight, Stethoscope, BookOpen } from 'lucide-react';

const Sidebar = ({ structure, activeSubspecialty, setActiveSubspecialty, onNavigate }) => {
  const toggleSubspecialty = (sub) => {
    setActiveSubspecialty(activeSubspecialty === sub ? null : sub);
  };

  return (
    <div className="w-64 h-screen bg-slate-900 text-white flex flex-col fixed left-0 top-0 overflow-y-auto z-40">
      <div className="p-4 bg-slate-800 flex items-center space-x-2 border-b border-slate-700 md:flex hidden">
        <Stethoscope className="text-blue-400" size={24} />
        <h1 className="font-bold text-lg tracking-tight">IM Preceptor Guide</h1>
      </div>

      <div className="p-4">
        <NavLink
          to="/"
          onClick={onNavigate}
          className={({ isActive }) => `flex items-center space-x-2 py-2 px-3 rounded-md transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
        >
          <BookOpen size={18} />
          <span>Teaching Guide</span>
        </NavLink>
      </div>

      <nav className="flex-1 px-2 space-y-1 pb-4">
        <h2 className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-4">Curriculum</h2>
        {Object.keys(structure).map((subspecialty) => (
          <div key={subspecialty} className="mb-1">
            <button
              onClick={() => toggleSubspecialty(subspecialty)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-800 focus:outline-none transition-colors"
            >
              <span>{subspecialty}</span>
              {activeSubspecialty === subspecialty ? (
                <ChevronDown size={16} className="text-slate-500" />
              ) : (
                <ChevronRight size={16} className="text-slate-500" />
              )}
            </button>

            {activeSubspecialty === subspecialty && (
              <div className="pl-6 mt-1 space-y-1">
                {Object.keys(structure[subspecialty]).map((condition) => (
                  <NavLink
                    key={condition}
                    to={`/condition/${encodeURIComponent(subspecialty)}/${encodeURIComponent(condition)}`}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `block py-1.5 px-3 rounded-md text-sm transition-colors ${
                        isActive ? 'bg-blue-600/20 text-blue-400 font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`
                    }
                  >
                    {condition}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
};

export default Sidebar;