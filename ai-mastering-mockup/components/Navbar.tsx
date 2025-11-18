import React from 'react';

const Navbar: React.FC = () => {
  return (
    <nav className="bg-gray-800 p-4 shadow-lg sticky top-0 z-10">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-2xl font-bold text-blue-400">AI Mastering Simulation</h1>
        <div className="text-sm">
          <a href="#" className="text-gray-300 hover:text-blue-300 transition-colors duration-200">
            About
          </a>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;