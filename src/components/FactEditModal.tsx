import React, { useState, useEffect } from 'react';
import { UserFact } from '../services/memoryService';
import { CharacterFact } from '../services/characterFactsService';
import { TableType } from '../services/adminService';

interface FactEditModalProps {
  tableName: TableType;
  fact?: any | null;
  onClose: () => void;
  onSave: (fact: any) => Promise<void>;
  isSaving: boolean;
}

const USER_CATEGORIES = ['identity', 'preference', 'relationship', 'context'];
const CHARACTER_CATEGORIES = ['quirk', 'relationship', 'experience', 'preference', 'detail', 'other'];

export default function FactEditModal({ tableName, fact, onClose, onSave, isSaving }: FactEditModalProps) {
  const categories = tableName === 'user_facts' ? USER_CATEGORIES : CHARACTER_CATEGORIES;
  
  const [formData, setFormData] = useState({
    category: categories[0],
    fact_key: '',
    fact_value: '',
    confidence: 1.0,
  });

  useEffect(() => {
    if (fact) {
      setFormData({
        category: fact.category,
        fact_key: fact.fact_key,
        fact_value: fact.fact_value,
        confidence: fact.confidence,
      });
    } else {
      // Reset to default category for the current table if creating new
      setFormData({
        category: categories[0],
        fact_key: '',
        fact_value: '',
        confidence: 1.0,
      });
    }
  }, [fact, tableName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
      <div 
        className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center bg-gray-800/50">
          <h2 className="text-xl font-bold text-white">
            {fact ? `Edit ${tableName === 'user_facts' ? 'User' : 'Character'} Fact` : `Add New ${tableName === 'user_facts' ? 'User' : 'Character'} Fact`}
          </h2>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
              required
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Fact Key</label>
            <input
              type="text"
              value={formData.fact_key}
              onChange={(e) => setFormData({ ...formData, fact_key: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
              placeholder="e.g. favorite_color"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Fact Value</label>
            <textarea
              value={formData.fact_value}
              onChange={(e) => setFormData({ ...formData, fact_value: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all min-h-[100px] resize-none"
              placeholder="e.g. Deep Blue"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Confidence ({Math.round(formData.confidence * 100)}%)
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={formData.confidence}
              onChange={(e) => setFormData({ ...formData, confidence: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:text-gray-400 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </>
              ) : fact ? 'Update Fact' : 'Create Fact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
