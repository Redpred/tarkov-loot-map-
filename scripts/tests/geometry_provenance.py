"""Independent checks for surface/texture continuity of clipped triangles."""
import numpy as np


def assert_interpolated_triangles(test, original, original_uv, actual, actual_uv):
    if not len(actual):
        return
    a, b = original[:, 1] - original[:, 0], original[:, 2] - original[:, 0]
    # Solve in position + UV space with SVD: terrain can contain needle-thin
    # triangles whose XYZ-only Gram determinant loses precision after float32 export.
    combined=np.concatenate([original/.001,original_uv/.002],axis=2)
    target=np.concatenate([actual/.001,actual_uv/.002],axis=2)
    edges=np.stack([combined[:,1]-combined[:,0],combined[:,2]-combined[:,0]],axis=2)
    coefficients=np.einsum('nij,nkj->nki',np.linalg.pinv(edges),target-combined[:,:1])
    weights=np.concatenate([1-coefficients.sum(axis=2,keepdims=True),coefficients],axis=2)
    # Find the closest convex combination. Simply clamping/renormalizing
    # barycentric coefficients is incorrect on long needle-shaped triangles.
    candidates=[weights]
    for corner in range(3):
        next_corner=(corner+1)%3
        edge=combined[:,next_corner]-combined[:,corner]
        t=((target-combined[:,corner,None])*edge[:,None]).sum(axis=2)/np.maximum((edge*edge).sum(axis=1)[:,None],1e-30)
        t=np.clip(t,0,1)
        candidate=np.zeros_like(weights);candidate[:,:,corner]=1-t;candidate[:,:,next_corner]=t
        candidates.append(candidate)
    distances=[]
    for candidate in candidates:
        reconstructed=np.einsum('nij,njk->nik',candidate,combined)
        distances.append(((reconstructed-target)**2).sum(axis=2))
    distances[0][(weights<0).any(axis=2)]=np.inf
    choice=np.stack(distances).argmin(axis=0)
    weights=np.choose(choice[:,:,None],candidates)
    reconstructed=np.einsum('nij,njk->nik',weights,original)
    np.testing.assert_allclose(actual,reconstructed,rtol=1e-5,atol=.001)
    expected_uv=np.einsum('nij,njk->nik',weights,original_uv)
    np.testing.assert_allclose(actual_uv,expected_uv,rtol=2e-4,atol=.002)
    old_normal=np.cross(a,b);new_normal=np.cross(actual[:,1]-actual[:,0],actual[:,2]-actual[:,0])
    test.assertTrue(((old_normal*new_normal).sum(axis=1)>=-1e-6).all(), 'Triangle winding changed')
    return weights
