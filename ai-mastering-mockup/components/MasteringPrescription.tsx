import React from 'react';
import { MasteringStep } from '../types';

interface MasteringPrescriptionProps {
  prescription: MasteringStep[];
}

const MasteringPrescription: React.FC<MasteringPrescriptionProps> = ({ prescription }) => {
  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-md border border-gray-700">
      <h3 className="text-2xl font-bold text-blue-400 mb-6">マスタリング処方箋</h3>
      <div className="space-y-6">
        {prescription.map((step, index) => (
          <div key={index} className="bg-gray-700 p-4 rounded-md shadow-inner border border-gray-600">
            <h4 className="text-lg font-semibold text-gray-200 mb-2">{step.title}</h4>
            <p className="text-gray-300 text-sm leading-relaxed">{step.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MasteringPrescription;