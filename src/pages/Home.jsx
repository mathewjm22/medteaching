import React from 'react';
import { BookOpen, CheckCircle, Activity, Heart, ArrowRight } from 'lucide-react';

const Home = () => {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight sm:text-5xl mb-4">
          Internal Medicine Teaching Guide
        </h1>
        <p className="text-xl text-slate-500 max-w-2xl mx-auto">
          A structured approach for orienting and guiding medical students through their Internal Medicine rotation.
        </p>
      </div>

      <div className="bg-white shadow-lg rounded-2xl overflow-hidden border border-slate-100 mb-12">
        <div className="bg-blue-600 px-6 py-4">
          <h2 className="text-xl font-bold text-white flex items-center">
            <Activity className="mr-2" /> Longitudinal Markers During the LIC
          </h2>
        </div>
        <div className="p-8">
          <p className="text-lg text-slate-700 mb-6 leading-relaxed">
            The start of the LIC represents the beginning of the foundational clinical medicine experience for most students. 
            <span className="font-semibold text-blue-700"> Set clear expectations and a road map of progression.</span>
          </p>

          <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
            
            {/* Phase 1 */}
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-300 group-[.is-active]:bg-blue-500 text-slate-500 group-[.is-active]:text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                    <BookOpen size={20} />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border border-slate-200 shadow-sm bg-white">
                    <div className="flex items-center justify-between space-x-2 mb-1">
                        <div className="font-bold text-slate-900">1st Trimester</div>
                        <div className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-full">Basics</div>
                    </div>
                    <div className="text-slate-600">
                        Focus on the basics of medicine (orientation to the clinic, proficient histories, physical exams). 
                        Start to work on differentials and illness scripts. Expect students to be slow in the beginning. 
                        It is normal for a new student to see <span className="font-semibold text-slate-800">1-2 patients per ½ day</span>.
                    </div>
                </div>
            </div>

            {/* Phase 2 */}
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-300 group-[.is-active]:bg-purple-500 text-slate-500 group-[.is-active]:text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                    <Heart size={20} />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border border-slate-200 shadow-sm bg-white">
                    <div className="flex items-center justify-between space-x-2 mb-1">
                        <div className="font-bold text-slate-900">Middle of Year</div>
                        <div className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-1 rounded-full">Gaps</div>
                    </div>
                    <div className="text-slate-600">
                        Focus on specific knowledge gaps. Students should be comfortable with clinic flow and can start targeting 
                        weaknesses in specific subspecialties or procedures.
                    </div>
                </div>
            </div>

            {/* Phase 3 */}
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-300 group-[.is-active]:bg-green-500 text-slate-500 group-[.is-active]:text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                    <CheckCircle size={20} />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border border-slate-200 shadow-sm bg-white">
                    <div className="flex items-center justify-between space-x-2 mb-1">
                        <div className="font-bold text-slate-900">End of Year</div>
                        <div className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">Advanced</div>
                    </div>
                    <div className="text-slate-600">
                        Student should be ready for more advanced clinical rotations. This includes strong differentials, 
                        making basic plans, placing/pending orders, following up with patients. 
                        Efficiency should increase to <span className="font-semibold text-slate-800">3-4 patients per session</span>.
                    </div>
                </div>
            </div>

          </div>
        </div>
      </div>

      <div className="bg-amber-50 rounded-xl p-6 border border-amber-200 flex items-start space-x-4">
        <div className="bg-amber-100 p-2 rounded-full mt-1">
          <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h3 className="text-amber-800 font-bold mb-2">Important Note for Preceptors</h3>
          <p className="text-amber-900 text-sm leading-relaxed">
            Expect some setbacks – it is normal for students to get worse before they get better. They are juggling a lot of new things and are not able to focus on your specialty alone like they were in the traditional model. If you are ever concerned something is not right, reach out to program leadership early so they can help.
          </p>
        </div>
      </div>

      <div className="mt-12 text-center">
        <p className="text-slate-500 flex items-center justify-center">
          Select a subspecialty from the sidebar to begin <ArrowRight className="ml-2 w-4 h-4" />
        </p>
      </div>
    </div>
  );
};

export default Home;