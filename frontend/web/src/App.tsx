import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SurveyData {
  id: string;
  title: string;
  category: string;
  encryptedResponse: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<SurveyData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSurvey, setCreatingSurvey] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSurveyData, setNewSurveyData] = useState({ title: "", category: "", response: "" });
  const [selectedSurvey, setSelectedSurvey] = useState<SurveyData | null>(null);
  const [decryptedResponse, setDecryptedResponse] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [stats, setStats] = useState({ total: 0, verified: 0, avgScore: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const surveysList: SurveyData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          surveysList.push({
            id: businessId,
            title: businessData.name,
            category: businessData.description,
            encryptedResponse: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading survey data:', e);
        }
      }
      
      setSurveys(surveysList);
      updateStats(surveysList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (surveyList: SurveyData[]) => {
    const total = surveyList.length;
    const verified = surveyList.filter(s => s.isVerified).length;
    const avgScore = total > 0 ? surveyList.reduce((sum, s) => sum + s.publicValue1, 0) / total : 0;
    
    setStats({ total, verified, avgScore });
  };

  const createSurvey = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSurvey(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating survey with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const responseValue = parseInt(newSurveyData.response) || 0;
      const businessId = `survey-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, responseValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSurveyData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newSurveyData.response) || 0,
        0,
        newSurveyData.category
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Survey created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSurveyData({ title: "", category: "", response: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSurvey(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleCheckAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSurveys = surveys.filter(survey => {
    const matchesSearch = survey.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         survey.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || survey.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(surveys.map(s => s.category))];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Market Research 🔍</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted market research surveys.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted research system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Market Research 🔍</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={handleCheckAvailability} className="availability-btn">
            Check FHE Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Survey
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Surveys</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-card">
            <h3>Avg Score</h3>
            <div className="stat-value">{stats.avgScore.toFixed(1)}</div>
          </div>
        </div>

        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search surveys..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-select">
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="surveys-grid">
          {filteredSurveys.length === 0 ? (
            <div className="no-surveys">
              <p>No surveys found</p>
              <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                Create First Survey
              </button>
            </div>
          ) : (
            filteredSurveys.map((survey, index) => (
              <div 
                className={`survey-card ${selectedSurvey?.id === survey.id ? "selected" : ""}`} 
                key={index}
                onClick={() => setSelectedSurvey(survey)}
              >
                <div className="card-header">
                  <h3>{survey.title}</h3>
                  <span className={`status-badge ${survey.isVerified ? "verified" : "pending"}`}>
                    {survey.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <div className="card-category">{survey.category}</div>
                <div className="card-meta">
                  <span>Score: {survey.publicValue1}/10</span>
                  <span>{new Date(survey.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="card-creator">
                  By: {survey.creator.substring(0, 6)}...{survey.creator.substring(38)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateSurvey 
          onSubmit={createSurvey} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSurvey} 
          surveyData={newSurveyData} 
          setSurveyData={setNewSurveyData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedSurvey && (
        <SurveyDetailModal 
          survey={selectedSurvey} 
          onClose={() => { 
            setSelectedSurvey(null); 
            setDecryptedResponse(null); 
          }} 
          decryptedResponse={decryptedResponse} 
          setDecryptedResponse={setDecryptedResponse} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedSurvey.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>🔐 Powered by FHE - Your privacy is protected</p>
          <div className="footer-links">
            <span>Terms</span>
            <span>Privacy</span>
            <span>Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const ModalCreateSurvey: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  surveyData: any;
  setSurveyData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, surveyData, setSurveyData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'response') {
      const intValue = value.replace(/[^\d]/g, '');
      setSurveyData({ ...surveyData, [name]: intValue });
    } else {
      setSurveyData({ ...surveyData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-survey-modal">
        <div className="modal-header">
          <h2>New Market Survey</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Survey responses are encrypted with Zama FHE for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Survey Title *</label>
            <input 
              type="text" 
              name="title" 
              value={surveyData.title} 
              onChange={handleChange} 
              placeholder="Enter survey title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={surveyData.category} onChange={handleChange}>
              <option value="">Select category</option>
              <option value="Technology">Technology</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Finance">Finance</option>
              <option value="Retail">Retail</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Response Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="response" 
              value={surveyData.response} 
              onChange={handleChange} 
              placeholder="Enter response score..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !surveyData.title || !surveyData.category || !surveyData.response} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Survey"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SurveyDetailModal: React.FC<{
  survey: SurveyData;
  onClose: () => void;
  decryptedResponse: number | null;
  setDecryptedResponse: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ survey, onClose, decryptedResponse, setDecryptedResponse, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedResponse !== null) { 
      setDecryptedResponse(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedResponse(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="survey-detail-modal">
        <div className="modal-header">
          <h2>Survey Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="survey-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{survey.title}</strong>
            </div>
            <div className="info-item">
              <span>Category:</span>
              <strong>{survey.category}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{survey.creator.substring(0, 6)}...{survey.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(survey.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Response Data</h3>
            
            <div className="data-row">
              <div className="data-label">Response Score:</div>
              <div className="data-value">
                {survey.isVerified && survey.decryptedValue ? 
                  `${survey.decryptedValue}/10 (Verified)` : 
                  decryptedResponse !== null ? 
                  `${decryptedResponse}/10 (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(survey.isVerified || decryptedResponse !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Verifying..." :
                 survey.isVerified ? "✅ Verified" :
                 decryptedResponse !== null ? "🔄 Re-verify" : "🔓 Verify"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy Protection</strong>
                <p>Individual responses are encrypted. Only statistical trends are revealed.</p>
              </div>
            </div>
          </div>
          
          {(survey.isVerified || decryptedResponse !== null) && (
            <div className="analysis-section">
              <h3>Response Analysis</h3>
              <div className="score-display">
                <div className="score-circle">
                  <span className="score-value">
                    {survey.isVerified ? survey.decryptedValue : decryptedResponse}
                  </span>
                  <span className="score-label">/10</span>
                </div>
                <div className="score-text">
                  <p>This response contributes to anonymous trend analysis while protecting your identity.</p>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;